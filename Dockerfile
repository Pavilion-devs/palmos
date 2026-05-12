FROM node:24-bookworm-slim

ENV DASHBOARD_API_PORT=4030
ENV NODE_ENV=production

WORKDIR /opt/render/project/src

COPY package.json package-lock.json ./
COPY packages/agent/package.json ./packages/agent/package.json
RUN npm ci --include=dev --legacy-peer-deps

COPY . .

EXPOSE 4030

CMD ["npm", "run", "dashboard:api"]
