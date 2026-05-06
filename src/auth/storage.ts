import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

export type SecureKey =
  | "client_id"
  | "client_secret"
  | "username"
  | "access_token"
  | "refresh_token"
  | "token_expires_at";

const ALL_KEYS: readonly SecureKey[] = [
  "client_id",
  "client_secret",
  "username",
  "access_token",
  "refresh_token",
  "token_expires_at",
];

// expo-secure-store has no native backing on web (SDK 55), so we fall back to
// localStorage. The spec calls this out explicitly: web uses localStorage as
// the closest equivalent for a self-hosted client.
const isWeb = Platform.OS === "web";

function webStorage(): Storage | null {
  if (typeof globalThis === "undefined") return null;
  const ls = (globalThis as { localStorage?: Storage }).localStorage;
  return ls ?? null;
}

export async function secureGet(key: SecureKey): Promise<string | null> {
  const storageKey = `wb_${key}`;
  if (isWeb) {
    return webStorage()?.getItem(storageKey) ?? null;
  }
  return SecureStore.getItemAsync(storageKey);
}

export async function secureSet(key: SecureKey, value: string): Promise<void> {
  const storageKey = `wb_${key}`;
  if (isWeb) {
    webStorage()?.setItem(storageKey, value);
    return;
  }
  await SecureStore.setItemAsync(storageKey, value);
}

export async function secureRemove(key: SecureKey): Promise<void> {
  const storageKey = `wb_${key}`;
  if (isWeb) {
    webStorage()?.removeItem(storageKey);
    return;
  }
  await SecureStore.deleteItemAsync(storageKey);
}

export async function secureClear(): Promise<void> {
  for (const k of ALL_KEYS) await secureRemove(k);
}
