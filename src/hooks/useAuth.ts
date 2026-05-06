import { useSyncExternalStore } from "react";
import { authStore, type AuthState } from "@/auth/state";

export function useAuth(): AuthState {
  return useSyncExternalStore(
    (cb) => authStore.subscribe(cb),
    () => authStore.get(),
    () => authStore.get(),
  );
}
