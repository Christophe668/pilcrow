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

export async function secureGet(key: SecureKey): Promise<string | null> {
  return SecureStore.getItemAsync(`wb_${key}`);
}

export async function secureSet(key: SecureKey, value: string): Promise<void> {
  await SecureStore.setItemAsync(`wb_${key}`, value);
}

export async function secureRemove(key: SecureKey): Promise<void> {
  await SecureStore.deleteItemAsync(`wb_${key}`);
}

export async function secureClear(): Promise<void> {
  for (const k of ALL_KEYS) await secureRemove(k);
}
