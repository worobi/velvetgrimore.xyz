FROM node:24-bookworm-slim AS dependencies

WORKDIR /build
COPY package*.json ./
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && npm ci --omit=dev && npm cache clean --force

FROM node:24-bookworm-slim

WORKDIR /app

COPY --from=dependencies /build/node_modules ./node_modules
COPY . .
RUN mkdir -p /data && chown node:node /data

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
ENV DATA_DIR=/data

EXPOSE 8080
VOLUME ["/data"]
USER node
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 CMD ["node", "scripts/health.js"]
CMD ["node", "server.js"]
