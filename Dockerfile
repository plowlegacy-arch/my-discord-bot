# syntax=docker/dockerfile:1

# ---------------------------------------------------------------- build stage
# Alpine base: avoids the Debian glibc/zlib advisories that have no fixed
# version in Debian 12/13/14. better-sqlite3 is compiled from source here.
FROM node:22.23.4-alpine AS build
ENV npm_config_update_notifier=false \
    npm_config_fund=false \
    npm_config_audit=false
WORKDIR /app

RUN apk upgrade --no-cache \
 && apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
COPY dashboard/package.json dashboard/package-lock.json ./dashboard/
RUN npm ci --no-audit --no-fund --build-from-source \
 && npm --prefix dashboard ci --no-audit --no-fund

COPY dashboard ./dashboard
RUN npm --prefix dashboard run build

COPY server ./server
RUN npm prune --omit=dev

# -------------------------------------------------------------- runtime stage
FROM node:22.23.4-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/app/data/trench.db
WORKDIR /app

RUN apk upgrade --no-cache \
 && apk add --no-cache libstdc++

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server ./server
COPY --from=build /app/dashboard/dist ./dashboard/dist

RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

EXPOSE 3000
CMD ["node", "server/index.js"]
