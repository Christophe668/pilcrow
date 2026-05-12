import { describe, it, expect, beforeEach, vi } from "vitest";

const secure = new Map<string, string>();
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (k: string) => secure.get(k) ?? null),
  setItemAsync: vi.fn(async (k: string, v: string) => void secure.set(k, v)),
  deleteItemAsync: vi.fn(async (k: string) => void secure.delete(k)),
}));

const asyncMem = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (k: string) => asyncMem.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => void asyncMem.set(k, v)),
    removeItem: vi.fn(async (k: string) => void asyncMem.delete(k)),
  },
}));

import { authStore, hydrateAuth, signIn, signOut } from "@/auth/state";

beforeEach(async () => {
  secure.clear();
  asyncMem.clear();
  authStore.set({ status: "unknown", serverUrl: null });
});

describe("auth state", () => {
  it("hydrates to unauthenticated when no tokens present", async () => {
    await hydrateAuth();
    expect(authStore.get().status).toBe("unauthenticated");
  });

  it("signIn writes tokens and transitions to authenticated", async () => {
    await signIn({
      serverUrl: "https://wb.test",
      clientId: "cid",
      clientSecret: "cs",
      username: "u",
      bundle: { access_token: "at", refresh_token: "rt", expires_in: 3600, token_type: "bearer" },
    });
    expect(authStore.get().status).toBe("authenticated");
    const state = authStore.get();
    if (state.status === "authenticated") {
      expect(state.serverUrl).toBe("https://wb.test");
    }
    expect(secure.get("wb_client_id")).toBe("cid");
    expect(secure.get("wb_username")).toBe("u");
  });

  it("signOut wipes all secure + async storage and transitions", async () => {
    await signIn({
      serverUrl: "https://wb.test",
      clientId: "cid",
      clientSecret: "cs",
      username: "u",
      bundle: { access_token: "at", refresh_token: "rt", expires_in: 3600, token_type: "bearer" },
    });
    await signOut();
    expect(authStore.get().status).toBe("unauthenticated");
    expect(secure.size).toBe(0);
  });

  it("signOut closes SQLite driver", async () => {
    const { setDbForTesting } = await import("@/db");
    const closed = vi.fn();
    setDbForTesting({
      exec: vi.fn(),
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn(),
      transaction: vi.fn(async (cb) =>
        cb({
          exec: vi.fn(),
          run: vi.fn(),
          get: vi.fn(),
          all: vi.fn(),
          transaction: vi.fn(),
          close: vi.fn(),
        } as never),
      ),
      close: closed,
    } as never);

    await signIn({
      serverUrl: "https://wb.test",
      clientId: "cid",
      clientSecret: "cs",
      username: "u",
      bundle: { access_token: "at", refresh_token: "rt", expires_in: 3600, token_type: "bearer" },
    });
    await signOut();
    expect(closed).toHaveBeenCalled();
  });
});
