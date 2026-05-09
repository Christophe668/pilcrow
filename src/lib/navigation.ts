import type { Href, Router } from "expo-router";

const LIBRARY_ROUTE = "/(app)/(library)" as Href;

/**
 * Pop the current screen if there is one to pop, otherwise navigate to a
 * sensible fallback. Calling `router.back()` on the root of the stack throws
 * the dev-only `'GO_BACK' was not handled by any navigator` warning, which
 * happens whenever the user lands directly on a screen via deep link, share
 * intent, or after the auth gate replaces the stack.
 */
export function goBackOrHome(router: Router, fallback: Href = LIBRARY_ROUTE): void {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace(fallback);
  }
}
