# PalmOS VPS Deployment

The frontend can deploy separately, but the private dashboard and SDK flows need a persistent backend. For the judge demo, deploy the backend to a VPS as a Docker container with a fresh persistent workspace.

## Target Shape

```text
Vercel/frontend
  -> https://api.your-domain.com
  -> Nginx/Caddy reverse proxy
  -> Docker container: palmos-api
  -> persistent volume: /var/lib/palmos/judge
```

PalmOS is an HTTP API, not just a background worker. Keep port `4030` private behind HTTPS if possible.

## VPS Requirements

- Ubuntu 22.04 or 24.04.
- 2 vCPU minimum.
- 2-4 GB RAM.
- 20+ GB disk.
- Docker.
- 2 GB swap on small boxes.
- Domain or subdomain for HTTPS.

## 1. Base Server Setup

```bash
apt update
apt upgrade -y
apt install -y ca-certificates curl gnupg git ufw htop nginx
```

Install Docker:

```bash
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
```

Add swap:

```bash
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

## 2. Put PalmOS On The Server

Clone from Git:

```bash
mkdir -p /opt/apps
cd /opt/apps
git clone <PALMOS_REPO_URL> palmos
cd palmos
```

Or copy from local:

```bash
rsync -az \
  --exclude node_modules \
  --exclude frontend/node_modules \
  --exclude .git \
  --exclude .env \
  --exclude assets \
  --exclude frontend \
  -e "ssh -i ~/.ssh/<key> -p <ssh-port>" \
  ./ root@<server-ip>:/opt/apps/palmos/
```

## 3. Create A Fresh Judge Workspace

Do not copy local `/tmp/palmos-live` unless you want all local proof/test records on the VPS.

Use a clean persistent workspace:

```bash
mkdir -p /var/lib/palmos/judge
chmod 700 /var/lib/palmos/judge
```

This directory maps to `/var/data/palmos-live` inside the container.

## 4. Create VPS `.env`

Create:

```text
/opt/apps/palmos/.env
```

Minimum judge backend env:

```text
AGENT_SPEND_OS_BASE_DIR=/var/data/palmos-live
DASHBOARD_API_PORT=4030
START_LOCAL_PUSD_SERVER=1
PALMOS_ENABLE_SHOWCASE_RUN=0
PALMOS_PUBLIC_ACCESS_MODE=1
PALMOS_JUDGE_ACCESS_CODE=<share-this-only-with-judges>
PALMOS_ALLOW_UNSAFE_SERVICE_ENDPOINTS=0
PALMOS_ALLOWED_ORIGINS=https://<frontend-domain>,http://localhost:5173,http://127.0.0.1:5173
PALMOS_FRONTEND_ORIGIN=https://<frontend-domain>

PUSD_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
PUSD_SOLANA_NETWORK=mainnet-beta
PUSD_MINT=CZzgUBvxaMLwMhVSLgqJn3npmxoTo6nzMNQPAnwtHF3s
PUSD_MERCHANT_WALLET=4tC7nLrTUz5nYhhWMspiXAuQcGpBVyRzuMNxR19Xaczy
PUSD_MAX_PER_CALL=0.05
PALMOS_REAL_PUSD_MAX_PER_CALL=0.05
PUSD_READINESS_AMOUNT=0.01

OWS_WALLET_PRIVATE_KEY=<funded-solana-private-key>
```

Optional:

```text
XMTP_ENV=dev
XMTP_WALLET_KEY=
XMTP_MANAGER_ADDRESS=
XMTP_MANAGER_INBOX_ID=
ZERION_API_KEY=
```

For the current MVP, `OWS_WALLET_PRIVATE_KEY` can act as the funded Solana payer fallback for both OWS and direct real-solana mode. Treat this as demo-mode custody, not the final per-agent wallet model.

## 5. Build And Run

```bash
cd /opt/apps/palmos
docker build -t palmos-api .
docker run -d \
  --name palmos-api \
  --restart unless-stopped \
  --env-file .env \
  -e AGENT_SPEND_OS_BASE_DIR=/var/data/palmos-live \
  -v /var/lib/palmos/judge:/var/data/palmos-live \
  -p 127.0.0.1:4030:4030 \
  palmos-api
```

Check logs:

```bash
docker ps
docker logs --tail=200 palmos-api
docker logs -f --tail=200 palmos-api
```

Health check from the VPS:

```bash
curl -sS http://127.0.0.1:4030/api/dashboard/health
```

Expected:

```json
{
  "ok": true,
  "baseDir": "/var/data/palmos-live",
  "localPusdServer": true
}
```

If `PALMOS_PUBLIC_ACCESS_MODE=1`, protected dashboard endpoints return `401 judge_access_required` until the frontend posts the judge passcode to `/api/dashboard/judge-access`.

## 6. Reverse Proxy

Example Nginx config for a domain-backed VPS:

```nginx
server {
  server_name api.your-domain.com;

  location / {
    proxy_pass http://127.0.0.1:4030;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Enable it:

```bash
ln -s /etc/nginx/sites-available/palmos-api /etc/nginx/sites-enabled/palmos-api
nginx -t
systemctl reload nginx
```

Add HTTPS with Certbot:

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d api.your-domain.com
```

Then smoke test:

```bash
curl -sS https://api.your-domain.com/api/dashboard/health
```

### TierHive HAProxy Note

On TierHive, the public IP can terminate at TierHive's edge Nginx/HAProxy instead of the VPS directly. If `curl http://<public-ip>/api/dashboard/health` returns a generic Nginx `404` while `curl http://127.0.0.1/api/dashboard/health` works on the VPS, add a TierHive HAProxy rule:

```text
frontend/public: <public HTTP host or port>
backend/private IP: 10.3.245.3
backend/private port: 80
mode: HTTP
```

The VPS Nginx should listen on port `80` and proxy to the container on `127.0.0.1:4030`.

## 7. Frontend Linkage

Set frontend env:

```text
VITE_DASHBOARD_API_BASE_URL=https://api.your-domain.com
```

Then redeploy frontend and test:

```text
#judge-access -> #dashboard
```

The backend `PALMOS_ALLOWED_ORIGINS` must include the deployed frontend origin.

## 8. Readiness Before Any Real Payment

From inside the container:

```bash
docker exec -it palmos-api npm run palmos:readiness -- \
  --recipient 4tC7nLrTUz5nYhhWMspiXAuQcGpBVyRzuMNxR19Xaczy \
  --amount 0.01
```

Only run real payment demos after readiness returns `ok: true`.

## 9. Updating The Backend

```bash
cd /opt/apps/palmos
git pull
docker build -t palmos-api .
docker stop palmos-api
docker rm palmos-api
docker run -d \
  --name palmos-api \
  --restart unless-stopped \
  --env-file .env \
  -e AGENT_SPEND_OS_BASE_DIR=/var/data/palmos-live \
  -v /var/lib/palmos/judge:/var/data/palmos-live \
  -p 127.0.0.1:4030:4030 \
  palmos-api
```

## 10. Operations

```bash
docker ps
docker logs --tail=200 palmos-api
docker logs -f --tail=200 palmos-api
docker restart palmos-api
docker stats palmos-api
df -h
free -h
uptime
```

## 11. Backup Fresh Judge Workspace

Once the workspace is curated:

```bash
tar -czf /root/palmos-judge-backup-$(date +%Y%m%d-%H%M%S).tgz -C /var/lib/palmos judge
```

## Caveats

- Do not enable `PALMOS_ENABLE_SHOWCASE_RUN=1` on a public judge backend unless you intentionally want the showcase route exposed.
- Keep `PALMOS_ALLOWED_ORIGINS` restricted to the deployed frontend URL and local development URLs.
- Do not rely on XMTP alerts for the main payment demo until the VPS runtime has a clean `@xmtp/node-sdk` native binding.
- Do not run parallel real-settlement demos while using the shared `OWS_WALLET_PRIVATE_KEY` fallback.
- Keep `PALMOS_REAL_PUSD_MAX_PER_CALL` low during judging.

## Render Fallback

`render.yaml` remains in the repo as a secondary deployment option, but the preferred judge path is the VPS Docker deployment above.
