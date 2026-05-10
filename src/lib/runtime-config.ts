/**
 * Runtime configuration loader.
 *
 * The Docker image's entrypoint writes `/runtime-config.json` next to
 * the static bundle with shape:
 *
 *   { "backend_url": "https://readeck.example.com", "same_origin": true }
 *
 * when `PILCROW_BACKEND_URL` is set on the container, or `{}` when it
 * isn't. Native builds, the dev server, and any deployment that
 * doesn't ship the file get `{}` by falling through the 404.
 *
 * The web app fetches this once at first paint and uses it to skip
 * the server-URL prompt when the operator already configured a
 * backend for the deployment.
 */

import { Platform } from "react-native";

export type RuntimeConfig = {
  /** Backend URL the deployment proxies same-origin requests to. */
  backendUrl: string | null;
  /** True when the deployment proxies `/api` to a backend. */
  sameOrigin: boolean;
};

const EMPTY: RuntimeConfig = { backendUrl: null, sameOrigin: false };

let cached: RuntimeConfig | null = null;
let inflight: Promise<RuntimeConfig> | null = null;

export function getCachedRuntimeConfig(): RuntimeConfig | null {
  return cached;
}

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  if (cached) return cached;
  if (inflight) return inflight;
  // Native builds don't ship a server next to them; skip the fetch.
  if (Platform.OS !== "web") {
    cached = EMPTY;
    return cached;
  }
  inflight = (async () => {
    try {
      const res = await fetch("/runtime-config.json", { cache: "no-store" });
      if (!res.ok) return EMPTY;
      const json = (await res.json()) as { backend_url?: string; same_origin?: boolean };
      const backendUrl =
        typeof json.backend_url === "string" && json.backend_url.length > 0
          ? json.backend_url
          : null;
      return { backendUrl, sameOrigin: json.same_origin === true };
    } catch {
      return EMPTY;
    }
  })();
  cached = await inflight;
  inflight = null;
  return cached;
}
