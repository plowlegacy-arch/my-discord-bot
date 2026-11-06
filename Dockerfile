# syntax=docker/dockerfile:1

# ---------------------------------------------------------------- build stage
FROM node:22-bookworm-slim AS build
ENV npm_config_update_notifier=false \
    npm_config_fund=false \
    npm_config_audit=false
WORKDIR /app

# toolchain for better-sqlite3 and a patched Debian base
RUN apt-get update \
 && apt-get upgrade -y \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY dashboard/package.json dashboard/package-lock.json ./dashboard/
RUN npm ci --no-audit --no-fund \
 && npm --prefix dashboard ci --no-audit --no-fund

COPY dashboard ./dashboard
RUN npm --prefix dashboard run build

COPY server ./server
RUN npm prune --omit=dev

# -------------------------------------------------------------- runtime stage
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/app/data/trench.db
WORKDIR /app

RUN apt-get update \
 && apt-get upgrade -y \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server ./server
COPY --from=build /app/dashboard/dist ./dashboard/dist

RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

EXPOSE 3000
CMD ["node", "server/index.js"]
