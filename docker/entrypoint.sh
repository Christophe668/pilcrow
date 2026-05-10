#!/bin/sh
# Pilcrow container entrypoint.
#
# Translates the optional `PILCROW_BACKEND_URL` env var into:
#   1. an nginx proxy block under /api/  → that backend
#   2. a /runtime-config.json the web app reads at startup so it can
#      pre-fill the sign-in URL with the user's own origin
#
# When `PILCROW_BACKEND_URL` is empty the container just serves the
# static site; the browser then talks cross-origin to whatever server
# the user types at sign-in. That mode requires CORS headers on the
# backend.

set -eu

BACKEND_URL="${PILCROW_BACKEND_URL:-}"

if [ -n "$BACKEND_URL" ]; then
    # Strip a trailing slash so `proxy_pass ${BACKEND_URL}` plus the
    # request's URI doesn't end up double-slashed.
    BACKEND_URL="${BACKEND_URL%/}"
    # Pull the hostname out for SNI + Host header. Without this nginx
    # would send the upstream IP as SNI and as Host, which CDNs like
    # Cloudflare reject (TLS alert 40 / 1016).
    BACKEND_HOST="${BACKEND_URL#*://}"
    BACKEND_HOST="${BACKEND_HOST%%/*}"
    BACKEND_HOST="${BACKEND_HOST%%:*}"
    PILCROW_BACKEND_PROXY=$(cat <<EOF
    # Same-origin backend proxy. Browser hits /api/... on this host;
    # nginx forwards to the configured Wallabag/Readeck server. No
    # CORS dance for the browser; no custom proxy header on the wire.
    location /api/ {
        proxy_pass ${BACKEND_URL}/api/;
        proxy_http_version 1.1;
        proxy_set_header Host ${BACKEND_HOST};
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_ssl_server_name on;
        proxy_ssl_name ${BACKEND_HOST};
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_read_timeout 60s;
        client_max_body_size 8m;
    }

    # Wallabag OAuth token endpoint sits outside /api on some versions.
    location /oauth/ {
        proxy_pass ${BACKEND_URL}/oauth/;
        proxy_http_version 1.1;
        proxy_set_header Host ${BACKEND_HOST};
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_ssl_server_name on;
        proxy_ssl_name ${BACKEND_HOST};
    }
EOF
)
    cat > /usr/share/nginx/html/runtime-config.json <<JSON
{ "backend_url": "${BACKEND_URL}", "same_origin": true }
JSON
else
    PILCROW_BACKEND_PROXY="    # Same-origin proxy is disabled (PILCROW_BACKEND_URL not set)."
    printf '{}\n' > /usr/share/nginx/html/runtime-config.json
fi

export PILCROW_BACKEND_PROXY

# Render the nginx config from the template.
envsubst '${PILCROW_BACKEND_PROXY}' \
    < /etc/nginx/conf.d/default.conf.template \
    > /etc/nginx/conf.d/default.conf

exec nginx -g 'daemon off;'
