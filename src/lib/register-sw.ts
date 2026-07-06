/**
 * Service-worker registration, web only.
 *
 * The worker itself lives in `public/sw.js` (copied to the dist root
 * by `expo export`). It makes the app shell loadable offline —
 * network-first HTML, cache-first /_expo/ bundle. Registration is
 * skipped in dev: the metro dev server has no hashed bundle to cache
 * and a stale worker there only causes confusion.
 */

import { Platform } from "react-native";

export function registerServiceWorker(): void {
  if (Platform.OS !== "web") return;
  if (__DEV__) return;
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  const register = () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Offline shell is progressive enhancement — the app works
      // without it, so a failed registration is not worth surfacing.
    });
  };

  // Wait for `load` so registration never competes with first paint —
  // unless the page already finished loading before we got here.
  if (document.readyState === "complete") {
    register();
  } else {
    window.addEventListener("load", register, { once: true });
  }
}
