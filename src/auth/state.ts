import { kvSet, kvGet, kvRemove } from "@/lib/async-storage";
import { secureSet, secureGet } from "@/auth/storage";
import { applyTokenBundle, clearTokens } from "@/auth/tokens";
import type { TokenBundle } from "@/api/types";
import { clearAllData, resetDb } from "@/db";
import { setActiveBackend } from "@/api/backend";
import { getActiveBackendKind, clearActiveBackendKind } from "@/api/backend/auth";

export type AuthState =
  | { status: "unknown"; serverUrl: null }
  | { status: "unauthenticated"; serverUrl: string | null }
  | { status: "authenticated"; serverUrl: string };

type Listener = (state: AuthState) => void;

class Store {
  private state: AuthState = { status: "unknown", serverUrl: null };
  private listeners = new Set<Listener>();

  get(): AuthState {
    return this.state;
  }
  set(next: AuthState) {
    this.state = next;
    for (const l of this.listeners) l(next);
  }
  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }
}

export const authStore = new Store();

export async function hydrateAuth(): Promise<void> {
  // Read token + server URL defensively. On native, expo-secure-store can
  // throw if the Android Keystore is in a weird state, the native module
  // hasn't been linked, or the user reinstalled the app under a different
  // signing key. Any failure here should land the user on the sign-in
  // screen rather than an infinite blank loader.
  let serverUrl: string | null = null;
  let access: string | null = null;
  try {
    serverUrl = await kvGet("server_url");
  } catch {
    serverUrl = null;
  }
  try {
    access = await secureGet("access_token");
  } catch {
    access = null;
  }
  // Bind the active backend before flipping the store, so any consumer
  // that re-renders on `authenticated` and immediately calls
  // `getBackend()` sees the right adapter.
  const kind = await getActiveBackendKind().catch(() => "wallabag" as const);
  setActiveBackend(kind);

  if (access && serverUrl) {
    authStore.set({ status: "authenticated", serverUrl });
  } else {
    authStore.set({ status: "unauthenticated", serverUrl });
  }
}

export async function signIn(args: {
  serverUrl: string;
  clientId: string;
  clientSecret: string;
  username: string;
  bundle: TokenBundle;
}): Promise<void> {
  await kvSet("server_url", args.serverUrl);
  await kvSet("backend_kind", "wallabag");
  await secureSet("client_id", args.clientId);
  await secureSet("client_secret", args.clientSecret);
  await secureSet("username", args.username);
  await applyTokenBundle(args.bundle);
  setActiveBackend("wallabag");
  authStore.set({ status: "authenticated", serverUrl: args.serverUrl });
}

/**
 * Called by the Readeck device-code flow once `pollReadeckSignIn`
 * returns `complete` — server URL, kind, and access_token were already
 * persisted by the helper, so this just flips the store.
 */
export function completeReadeckSignIn(serverUrl: string): void {
  setActiveBackend("readeck");
  authStore.set({ status: "authenticated", serverUrl });
}

export async function signOut(): Promise<void> {
  // Clear lightweight storage + flip the store FIRST. A concurrent
  // sync transaction on the wasm-backed SQLite driver (web) can leave
  // the connection in a state where DELETE / close throws; we don't
  // want that to keep the user signed in with a useless button.
  await Promise.allSettled([
    clearTokens(),
    kvRemove("server_url"),
    kvRemove("last_user_id"),
    clearActiveBackendKind(),
  ]);
  setActiveBackend("wallabag");
  authStore.set({ status: "unauthenticated", serverUrl: null });
  // Best-effort DB wipe + close. Failures here are logged in dev but
  // never block the navigation away from the authed surface.
  try {
    await clearAllData();
  } catch (e) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn("[auth] clearAllData failed during signOut", e);
    }
  }
  try {
    await resetDb();
  } catch (e) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn("[auth] resetDb failed during signOut", e);
    }
  }
}
