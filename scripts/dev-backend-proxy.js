/**
 * Dev-only Metro middleware that forwards `/__backend-proxy/*` requests
 * to the backend host carried in the `x-proxy-target` request header.
 *
 * The web build runs same-origin against the dev server (no CORS), and
 * this middleware fans out to whichever Wallabag/Readeck server the
 * client is talking to. It only runs under `expo start` — `expo export`
 * for production never invokes it.
 *
 * Native builds and the `proxiedFetch` helper bypass this entirely.
 */

const PROXY_PATH = "/__backend-proxy";
const PROXY_TARGET_HEADER = "x-proxy-target";

// Hop-by-hop headers per RFC 7230 §6.1; never forward.
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

// Node's built-in `fetch` (undici) transparently decodes
// `content-encoding` when we call `arrayBuffer()`, so by the time we
// forward the body it's already plain bytes. Re-emitting the upstream
// encoding/length headers would tell the browser to gunzip raw JSON,
// which fails with a bare `TypeError: Failed to fetch`. Strip them on
// the response so the browser treats the body as-is.
const STRIP_RESPONSE_HEADERS = new Set(["content-encoding", "content-length"]);

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function pickHeaders(source, drop) {
  const out = {};
  for (const [k, v] of Object.entries(source)) {
    if (v === undefined) continue;
    if (drop.has(k.toLowerCase())) continue;
    out[k] = Array.isArray(v) ? v.join(", ") : String(v);
  }
  return out;
}

// Loopback addresses. The dev proxy will refuse to forward for any
// non-loopback caller — see `isLoopback` for why.
const LOOPBACK_REMOTES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function isLoopback(req) {
  // `remoteAddress` reflects the actual TCP peer; we don't honor
  // forwarded-for headers because anyone can set those. If Metro is
  // bound to 0.0.0.0 (via `expo start --host lan` etc.) we still want
  // only the developer's own machine to be able to fan out through
  // the proxy — otherwise anyone on the same Wi-Fi could use it as
  // an open relay by setting `x-proxy-target` themselves.
  const addr = req.socket && req.socket.remoteAddress;
  return typeof addr === "string" && LOOPBACK_REMOTES.has(addr);
}

async function handle(req, res) {
  if (!isLoopback(req)) {
    res.statusCode = 403;
    res.setHeader("content-type", "text/plain");
    res.end("Proxy is loopback-only");
    return;
  }
  const target = req.headers[PROXY_TARGET_HEADER];
  if (typeof target !== "string" || !target) {
    res.statusCode = 400;
    res.setHeader("content-type", "text/plain");
    res.end(`Missing ${PROXY_TARGET_HEADER} header`);
    return;
  }
  let targetOrigin;
  try {
    targetOrigin = new URL(target);
  } catch {
    res.statusCode = 400;
    res.setHeader("content-type", "text/plain");
    res.end(`Invalid ${PROXY_TARGET_HEADER}: ${target}`);
    return;
  }

  const subPath = req.url.slice(PROXY_PATH.length) || "/";
  const upstreamUrl = `${targetOrigin.protocol}//${targetOrigin.host}${subPath}`;
  const headers = pickHeaders(
    req.headers,
    new Set([...HOP_BY_HOP, PROXY_TARGET_HEADER, "origin", "referer", "accept-encoding"]),
  );
  // Force upstream to send uncompressed bytes. Node's `fetch` should
  // transparently decompress gzip/br/zstd, but version skew or proxy
  // chains can leave us re-emitting compressed bytes without the
  // matching `Content-Encoding` header — the browser then decodes
  // gibberish. Asking for `identity` sidesteps the whole decode dance.
  headers["accept-encoding"] = "identity";

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const body = hasBody ? await readBody(req) : undefined;

  let upstream;
  try {
    upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body: body && body.length > 0 ? body : undefined,
    });
  } catch (e) {
    res.statusCode = 502;
    res.setHeader("content-type", "text/plain");
    res.end(`Proxy fetch failed: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }

  res.statusCode = upstream.status;
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower)) return;
    if (STRIP_RESPONSE_HEADERS.has(lower)) return;
    if (lower === "cache-control" || lower === "etag" || lower === "expires") return;
    res.setHeader(key, value);
  });
  // Prevent Chrome from caching dev-proxy responses. Conditional 304s
  // would otherwise pin whatever corrupted body the browser cached
  // (e.g. while we were forwarding `Content-Encoding: gzip` against
  // an already-decompressed body) and keep serving it indefinitely.
  res.setHeader("cache-control", "no-store");
  const buf = Buffer.from(await upstream.arrayBuffer());
  res.end(buf);
}

function backendProxyMiddleware() {
  return (req, res, next) => {
    if (!req.url || !req.url.startsWith(PROXY_PATH)) {
      next();
      return;
    }
    handle(req, res).catch((e) => {
      res.statusCode = 500;
      res.setHeader("content-type", "text/plain");
      res.end(`Proxy error: ${e instanceof Error ? e.message : String(e)}`);
    });
  };
}

module.exports = { backendProxyMiddleware, PROXY_PATH, PROXY_TARGET_HEADER };
