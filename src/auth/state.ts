import { kvSet, kvGet, kvRemove } from "@/lib/async-storage";
import { secureSet, secureGet } from "@/auth/storage";
import { applyTokenBundle, clearTokens } from "@/auth/tokens";
import type { TokenBundle } from "@/api/types";
import { clearAllData, resetDb } from "@/db";

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
  await secureSet("client_id", args.clientId);
  await secureSet("client_secret", args.clientSecret);
  await secureSet("username", args.username);
  await applyTokenBundle(args.bundle);
  authStore.set({ status: "authenticated", serverUrl: args.serverUrl });
}

export async function signOut(): Promise<void> {
  await clearAllData();
  await resetDb();
  await clearTokens();
  await kvRemove("server_url");
  await kvRemove("last_user_id");
  authStore.set({ status: "unauthenticated", serverUrl: null });
}
