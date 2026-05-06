import AsyncStorage from "@react-native-async-storage/async-storage";

export type AsyncKey = "server_url" | "last_user_id" | "theme_mode";

export async function kvGet(key: AsyncKey): Promise<string | null> {
  return AsyncStorage.getItem(`wb:${key}`);
}

export async function kvSet(key: AsyncKey, value: string): Promise<void> {
  await AsyncStorage.setItem(`wb:${key}`, value);
}

export async function kvRemove(key: AsyncKey): Promise<void> {
  await AsyncStorage.removeItem(`wb:${key}`);
}

export async function kvClear(): Promise<void> {
  for (const k of ["server_url", "last_user_id", "theme_mode"] as const) {
    await kvRemove(k);
  }
}
