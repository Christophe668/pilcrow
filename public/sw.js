/*
 * Pilcrow service worker — keeps the app shell loadable offline.
 *
 * Article data already lives in local SQLite (expo-sqlite on web); the
 * only thing missing for a fully offline PWA is the shell itself. Two
 * strategies, nothing else:
 *
 *   - navigations (HTML): network-first, falling back to the last
 *     cached copy, then to the cached root shell. Fresh deploys win
 *     whenever the network is up.
 *   - /_expo/ bundle: cache-first. Files are content-hashed, so a hit
 *     is immutable and a miss is a new deploy.
 *
 * Everything else (/api/, /oauth/, /runtime-config.json, images) is
 * left alone and goes straight to the network.
 *
 * Bump VERSION to invalidate both caches on a breaking change. nginx
 * serves this file with `Cache-Control: no-cache`, so browsers
 * revalidate it on every load and pick up new deploys promptly.
 */

const VERSION = "v1";
const HTML_CACHE = `pilcrow-html-${VERSION}`;
const ASSET_CACHE = `pilcrow-assets-${VERSION}`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      // Seed the root shell so deep links work offline even if the
      // user never visited "/" (navigation fallback below).
      const cache = await caches.open(HTML_CACHE);
      await cache.add(new Request("/", { cache: "no-cache" })).catch(() => undefined);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = [HTML_CACHE, ASSET_CACHE];
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("pilcrow-") && !keep.includes(name))
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

async function networkFirstHtml(request) {
  const cache = await caches.open(HTML_CACHE);
  try {
    const fresh = await fetch(request);
    // Don't cache errors or redirects — a cached redirect served for a
    // navigation is rejected by some browsers.
    if (fresh.ok && !fresh.redirected) {
      cache.put(request, fresh.clone());
    }
    return fresh;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    // SPA fallback, mirroring nginx's `try_files ... /index.html`.
    const shell = await cache.match("/");
    if (shell) return shell;
    return Response.error();
  }
}

async function cacheFirstAsset(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh.ok) {
    cache.put(request, fresh.clone());
  }
  return fresh;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstHtml(request));
    return;
  }

  if (url.pathname.startsWith("/_expo/")) {
    event.respondWith(cacheFirstAsset(request));
  }
});
