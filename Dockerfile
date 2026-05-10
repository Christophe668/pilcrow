# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────
# Pilcrow — Wallabag / Readeck reading client, static web build, served
# by nginx.
#
# This image only ships the web target. Native iOS/Android cannot be
# built in Docker (Apple toolchain is macOS-only); use EAS for those.
#
# Build:
#   docker build -t pilcrow-web .
#
# Run:
#   # Cross-origin mode (backend must send CORS headers)
#   docker run --rm -p 8080:80 pilcrow-web
#
#   # Same-origin mode (recommended for self-hosted single-backend setups).
#   # PILCROW_BACKEND_URL is the URL of your Readeck OR Wallabag server.
#   # Pick the one you actually sign in to:
#   docker run --rm -p 8080:80 \
#     -e PILCROW_BACKEND_URL=https://readeck.example.com \
#     pilcrow-web
#   # or:
#   docker run --rm -p 8080:80 \
#     -e PILCROW_BACKEND_URL=https://app.wallabag.it \
#     pilcrow-web
#
# In same-origin mode the container proxies /api/ and /oauth/ to the
# configured backend, so the browser never makes cross-origin requests
# and you don't need to add CORS headers to your Wallabag/Readeck server.
# ─────────────────────────────────────────────────────────────────────

# ── Stage 1: build ───────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build

# corepack ships with Node 22; it lets us pin pnpm via package.json's
# engines/packageManager. We don't pin here, so just enable the latest.
RUN corepack enable

WORKDIR /app

# Copy only the files needed to resolve the dependency graph first so
# this layer caches across source-only changes.
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches

# `--ignore-scripts` skips the better-sqlite3 native build (devDep,
# only used by the vitest test suite — never bundled into the web
# output). Keeps the build image free of python/g++ toolchains.
RUN pnpm install --frozen-lockfile --ignore-scripts

# Bring in the rest of the source.
COPY . .

# Static export → ./dist (config: web.output = "static" in app.config.ts).
# Pre-renders one HTML file per known route plus a hashed asset bundle
# under /_expo. No SSR runtime is needed.
RUN pnpm exec expo export -p web

# ── Stage 2: serve ───────────────────────────────────────────────────
FROM nginx:1.27-alpine AS serve

# `envsubst` lives in gettext; the alpine base doesn't include it.
RUN apk add --no-cache gettext

# nginx config is a template — the entrypoint runs envsubst over it
# at container start so `PILCROW_BACKEND_URL` can flip the proxy on
# without a rebuild. Final file lands at default.conf.
COPY docker/nginx.conf.template /etc/nginx/conf.d/default.conf.template
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Static site only — no node, no source, no node_modules.
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1/healthz || exit 1

# Drop signal-quitting niceties for a clean container exit.
STOPSIGNAL SIGQUIT

ENTRYPOINT ["/entrypoint.sh"]
