import { describe, it, expect, beforeEach, vi } from "vitest";

const secure = new Map<string, string>();
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (k: string) => secure.get(k) ?? null),
  setItemAsync: vi.fn(async (k: string, v: string) => void secure.set(k, v)),
  deleteItemAsync: vi.fn(async (k: string) => void secure.delete(k)),
}));

const refreshSpy = vi.fn();
vi.mock("@/auth/oauth", async () => {
  const actual = await vi.importActual<typeof import("@/auth/oauth")>("@/auth/oauth");
  return {
    ...actual,
    refreshGrant: vi.fn(async (args) => {
      refreshSpy(args);
      return {
        access_token: "at-new",
        refresh_token: "rt-new",
        expires_in: 3600,
        token_type: "bearer" as const,
      };
    }),
  };
});

import { ensureFreshToken, applyTokenBundle, getAccessToken, clearTokens } from "@/auth/tokens";

beforeEach(async () => {
  secure.clear();
  refreshSpy.mockClear();
});

describe("token state machine", () => {
  it("returns the access token when not near expiry", async () => {
    await applyTokenBundle({
      access_token: "at-1",
      refresh_token: "rt-1",
      expires_in: 3600,
      token_type: "bearer",
    });
    const before = await getAccessToken();
    expect(before).toBe("at-1");
    const after = await ensureFreshToken({
      serverUrl: "https://wb.test",
      clientId: "cid",
      clientSecret: "cs",
    });
    expect(after).toBe("at-1");
    expect(refreshSpy).not.toHaveBeenCalled();
  });

  it("refreshes when expiry within 60s", async () => {
    secure.set("wb_access_token", "at-old");
    secure.set("wb_refresh_token", "rt-old");
    secure.set("wb_token_expires_at", String(Date.now() + 30_000));
    const after = await ensureFreshToken({
      serverUrl: "https://wb.test",
      clientId: "cid",
      clientSecret: "cs",
    });
    expect(after).toBe("at-new");
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent refreshes into a single request", async () => {
    secure.set("wb_access_token", "at-old");
    secure.set("wb_refresh_token", "rt-old");
    secure.set("wb_token_expires_at", String(Date.now() - 1));
    const calls = await Promise.all(
      Array.from({ length: 5 }, () =>
        ensureFreshToken({ serverUrl: "https://wb.test", clientId: "cid", clientSecret: "cs" }),
      ),
    );
    expect(new Set(calls)).toEqual(new Set(["at-new"]));
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });

  it("clears persistent token state", async () => {
    await applyTokenBundle({
      access_token: "at",
      refresh_token: "rt",
      expires_in: 3600,
      token_type: "bearer",
    });
    await clearTokens();
    expect(await getAccessToken()).toBeNull();
  });
});
