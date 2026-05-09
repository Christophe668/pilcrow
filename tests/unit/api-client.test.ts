import { describe, it, expect, beforeEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../src/test/msw-server";

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

import { request, SessionExpiredError } from "@/api/client";
import { applyTokenBundle } from "@/auth/tokens";
import { authStore } from "@/auth/state";

beforeEach(async () => {
  secure.clear();
  secure.set("wb_client_id", "cid");
  secure.set("wb_client_secret", "cs");
  await applyTokenBundle({
    access_token: "at-1",
    refresh_token: "rt-1",
    expires_in: 3600,
    token_type: "bearer",
  });
});

describe("api request()", () => {
  it("attaches the bearer token", async () => {
    server.use(
      http.get("https://wb.test/api/info.json", ({ request }) => {
        expect(request.headers.get("authorization")).toBe("Bearer at-1");
        return HttpResponse.json({ appname: "wallabag", version: "2.6.9" });
      }),
    );
    const r = await request<{ appname: string }>({
      serverUrl: "https://wb.test",
      method: "GET",
      path: "/api/info.json",
    });
    expect(r.appname).toBe("wallabag");
  });

  it("retries once on 401 after refresh", async () => {
    let calls = 0;
    server.use(
      http.post("https://wb.test/oauth/v2/token", () =>
        HttpResponse.json({
          access_token: "at-2",
          refresh_token: "rt-2",
          expires_in: 3600,
          token_type: "bearer",
        }),
      ),
      http.get("https://wb.test/api/info.json", ({ request }) => {
        calls += 1;
        const auth = request.headers.get("authorization");
        if (auth === "Bearer at-1") {
          return HttpResponse.json({ error: "invalid_grant" }, { status: 401 });
        }
        return HttpResponse.json({ appname: "wallabag", version: "2.6.9" });
      }),
    );
    const r = await request<{ appname: string }>({
      serverUrl: "https://wb.test",
      method: "GET",
      path: "/api/info.json",
    });
    expect(r.appname).toBe("wallabag");
    expect(calls).toBe(2);
  });

  it("signs the user out and throws SessionExpiredError when refresh fails with invalid_grant", async () => {
    // The original request returns 401, the forced refresh call returns
    // 400 invalid_grant — the user's refresh token is dead. The client
    // should detect this, sign out (so the auth gate routes back to
    // login), and throw SessionExpiredError so the caller can avoid a
    // misleading "Invalid credentials" toast.
    authStore.set({ status: "authenticated", serverUrl: "https://wb.test" });
    server.use(
      http.post("https://wb.test/oauth/v2/token", () =>
        HttpResponse.json({ error: "invalid_grant" }, { status: 400 }),
      ),
      http.get("https://wb.test/api/info.json", () =>
        HttpResponse.json({ error: "expired" }, { status: 401 }),
      ),
    );
    await expect(
      request({ serverUrl: "https://wb.test", method: "GET", path: "/api/info.json" }),
    ).rejects.toBeInstanceOf(SessionExpiredError);
    expect(authStore.get().status).toBe("unauthenticated");
  });
});
