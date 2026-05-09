# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────
# Pilcrow — Wallabag reading client, static web build, served by nginx.
#
# This image only ships the web target. Native iOS/Android cannot be
# built in Docker (Apple toolchain is macOS-only); use EAS for those.
#
# Build:
#   docker build -t pilcrow-web .
#
# Run:
#   docker run --rm -p 8080:80 pilcrow-web
#   open http://localhost:8080
#
# The user's Wallabag *server* URL is configured at runtime by the
# end-user via the in-app auth flow — there is no build-time API URL.
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

# SPA fallback + gzip + long-cache for hashed assets.
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

# Static site only — no node, no source, no node_modules.
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

# Drop signal-quitting niceties for a clean container exit.
STOPSIGNAL SIGQUIT

# nginx:alpine's default CMD already runs nginx in the foreground.
