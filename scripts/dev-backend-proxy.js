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

async function handle(req, res) {
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
    new Set([...HOP_BY_HOP, PROXY_TARGET_HEADER, "origin", "referer"]),
  );

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
    if (HOP_BY_HOP.has(key.toLowerCase())) return;
    res.setHeader(key, value);
  });
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
