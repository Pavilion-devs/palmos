# Releasing the PalmOS npm packages

Two packages publish from this repo:

- [`@getpalmos/agent`](https://www.npmjs.com/package/@getpalmos/agent) — `packages/agent`, the SDK client.
- `@getpalmos/mcp` — `packages/mcp`, the MCP server that exposes PalmOS as agent tools.

Both live under the `getpalmos` npm org and publish as public scoped packages.

## Prerequisites

- Membership in the `getpalmos` npm org with publish rights.
- An npm **Automation** access token: npmjs.com → *Access Tokens* → *Generate New
  Token* → **Classic Token** → type **Automation**.
  - Automation tokens **bypass 2FA**, which npm now enforces for publishing.
  - A classic *Publish* token (or 2FA-OTP flow) will fail with
    `E403 ... granular access token with bypass 2fa enabled is required`.
- Treat the token like a secret. Do not commit it. Prefer a CI secret or a
  throwaway `~/.npmrc` you delete afterward.

## Release steps

From the repo root:

1. Make sure `main` is clean and your change is committed.

2. Bump the version (npm refuses to republish an existing version):

   ```bash
   npm version patch --workspace @getpalmos/agent --no-git-tag-version   # or minor / major
   # or for the MCP server:
   npm version patch --workspace @getpalmos/mcp --no-git-tag-version
   ```

3. Authenticate non-interactively with the automation token, then publish.
   `prepublishOnly` rebuilds `dist/` first (it is gitignored), and
   `publishConfig.access: public` makes the scoped package public:

   ```bash
   export NPM_TOKEN=npm_xxx_your_automation_token
   echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > /tmp/palmos-npmrc

   NPM_CONFIG_USERCONFIG=/tmp/palmos-npmrc npm publish -w @getpalmos/agent
   # and / or:
   NPM_CONFIG_USERCONFIG=/tmp/palmos-npmrc npm publish -w @getpalmos/mcp

   rm -f /tmp/palmos-npmrc
   ```

   > Interactive alternative: `npm login` then `npm publish -w @getpalmos/agent`.
   > With account 2FA on, npm will prompt for a one-time password.

4. Commit the version bump and push:

   ```bash
   git commit -am "Release @getpalmos/agent vX.Y.Z"
   git push origin main
   ```

5. Verify:

   ```bash
   npm view @getpalmos/agent version
   ```

   The first publish of a new version can take 1–2 minutes to appear on the
   registry read API / package page — the `PUT` succeeding (`+ name@version`) is
   the source of truth.

## Notes

- `dist/` is gitignored for both packages; the published tarball is built fresh
  by `prepublishOnly`. Never hand-commit `dist`.
- `@getpalmos/agent` ships `dist`, `examples`, `README.md` via its `files`
  allowlist; npm always adds `LICENSE` + `package.json`.
- `@getpalmos/mcp` ships `dist` + `README.md` and depends on `@getpalmos/agent`,
  so publish a matching (or newer) `@getpalmos/agent` first if the client API
  changed.
- The client defaults to `https://api.getpalmos.xyz`; consumers override with
  `PALMOS_API_URL` for a self-hosted backend.
