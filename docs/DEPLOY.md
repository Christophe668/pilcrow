# Deploying Pilcrow web

Pilcrow ships a static web build. The included Dockerfile produces an
`nginx:alpine` image that serves it. Two deployment modes — pick the one
that matches your network shape.

## Mode A — same-origin proxy (recommended)

The container proxies `/api/` and `/oauth/` requests to a backend you set
at run time. The browser only ever talks to the Pilcrow container, so
**you don't need to add CORS headers** to your Wallabag/Readeck server.

`PILCROW_BACKEND_URL` is the URL of **your Readeck _or_ Wallabag server**
— the same URL you'd otherwise type at sign-in. Pick whichever one you
actually use:

```bash
# Readeck
docker run -d \
  --name pilcrow \
  --restart unless-stopped \
  -p 8080:80 \
  -e PILCROW_BACKEND_URL=https://readeck.example.com \
  pilcrow-web:latest

# Wallabag (hosted or self-hosted)
docker run -d \
  --name pilcrow \
  --restart unless-stopped \
  -p 8080:80 \
  -e PILCROW_BACKEND_URL=https://app.wallabag.it \
  pilcrow-web:latest
```

Or with Compose — keep one, comment the other:

```yaml
services:
  pilcrow:
    image: pilcrow-web:latest
    build: .
    ports: ["8080:80"]
    environment:
      # Readeck
      PILCROW_BACKEND_URL: https://readeck.example.com
      # ─ or ─ Wallabag
      # PILCROW_BACKEND_URL: https://app.wallabag.it
    restart: unless-stopped
```

What this does:

- The container's entrypoint writes `/usr/share/nginx/html/runtime-config.json`
  with `{ "backend_url": "...", "same_origin": true }`.
- The web app reads that file on first paint, pre-fills the sign-in
  screen with `window.location.origin`, and the user just taps
  **Continue**.
- nginx forwards requests under `/api/` and `/oauth/` to the configured
  host. Everything else is the static site.

**Trade-off:** one container can only point at one backend. If you want
to support sign-in to arbitrary servers, use Mode B.

## Mode B — cross-origin (multi-backend)

Leave `PILCROW_BACKEND_URL` unset. The image just serves the static
site, and the browser talks directly to whichever URL the user types at
sign-in. **You must add CORS headers to your Wallabag/Readeck server**
for the origin you're hosting Pilcrow on, or the browser will block
every fetch.

### Adding CORS to Wallabag

Wallabag is a Symfony app served by nginx or apache. Add response
headers on the API location block, e.g. for nginx:

```nginx
location /api/ {
    add_header Access-Control-Allow-Origin "https://pilcrow.example.com" always;
    add_header Access-Control-Allow-Methods "GET, POST, PATCH, DELETE, OPTIONS" always;
    add_header Access-Control-Allow-Headers "Authorization, Content-Type" always;
    if ($request_method = OPTIONS) { return 204; }
    # … existing fastcgi/proxy directives …
}
location /oauth/ {
    # same three add_header lines
}
```

Restart nginx; clear your browser cache once.

### Adding CORS to Readeck

Readeck has built-in CORS support since 0.13. Set in `config.toml`:

```toml
[server]
allowed_origins = ["https://pilcrow.example.com"]
```

…and restart the Readeck service.

## Common reverse-proxy setup

If you already run a reverse proxy (Caddy, Nginx Proxy Manager, Traefik,
Synology's built-in reverse proxy), put both Pilcrow and the backend
behind it on the **same hostname**:

```
https://reader.example.com/         → Pilcrow container
https://reader.example.com/api/     → Readeck/Wallabag (proxied through)
https://reader.example.com/oauth/   → Wallabag OAuth (if Wallabag)
```

Same effect as Mode A without the env var — the browser sees one origin.

## Health check

The container exposes `GET /healthz` returning `200 ok`. The Dockerfile
declares a HEALTHCHECK so `docker ps` shows container health.

## Updating

```bash
git pull
docker compose up -d --build   # or rebuild & restart manually
```

The build is reproducible: same commit → same bundle.
