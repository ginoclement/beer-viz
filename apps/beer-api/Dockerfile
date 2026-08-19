# Debian (glibc) base — @duckdb/node-api ships prebuilt glibc binaries; Alpine
# (musl) would not load them.
FROM node:20-slim

WORKDIR /app

# Install prod deps against the lockfile for reproducible builds.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server.mjs build-db.mjs ./

# The read-only query DB + aggregates.json are mounted at runtime (see
# docker-compose.yml) — built offline by `npm run build:db`, never at runtime.
ENV PORT=8080 \
    DB_PATH=/data/beer.duckdb \
    AGG_PATH=/data/aggregates.json
EXPOSE 8080

# Reachable only via the internal "apis" network (cloudflared); no host ports.
CMD ["node", "server.mjs"]
