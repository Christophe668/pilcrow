/**
 * Dev-only fetch shim that routes backend requests through the Expo
 * dev server when running on web.
 *
 * Browsers enforce CORS, but most self-hosted backends (Readeck,
 * Wallabag) don't ship `Access-Control-Allow-Origin`. The Metro
 * middleware in `metro.config.js` handles `/__backend-proxy/*` by
 * forwarding to the host carried in `x-proxy-target` — same-origin
 * from the browser's view, no preflight needed.
 *
 * On native and in production web builds, this is a passthrough.
 */

import { Platform } from "react-native";

export const PROXY_PATH = "/__backend-proxy";
export const PROXY_TARGET_HEADER = "x-proxy-target";

export function proxiedFetch(url: string, init?: RequestInit): Promise<Response> {
  if (Platform.OS !== "web" || !__DEV__) {
    return fetch(url, init);
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return fetch(url, init);
  }
  // Same-origin requests (the dev server itself) bypass the proxy.
  if (typeof window !== "undefined" && parsed.origin === window.location.origin) {
    return fetch(url, init);
  }
  const target = `${parsed.protocol}//${parsed.host}`;
  const rewritten = `${PROXY_PATH}${parsed.pathname}${parsed.search}`;
  const headers = new Headers(init?.headers);
  headers.set(PROXY_TARGET_HEADER, target);
  return fetch(rewritten, { ...init, headers });
}
