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

import { authedRequest } from "@/api/client";
import { applyTokenBundle } from "@/auth/tokens";

beforeEach(async () => {
  secure.clear();
  asyncMem.clear();
  secure.set("wb_client_id", "cid");
  secure.set("wb_client_secret", "cs");
  await applyTokenBundle({
    access_token: "at-1",
    refresh_token: "rt-1",
    expires_in: 3600,
    token_type: "bearer",
  });
});

describe("authedRequest", () => {
  it("reads server URL from AsyncStorage", async () => {
    asyncMem.set("wb:server_url", "https://wb.test");
    server.use(
      http.get("https://wb.test/api/info.json", () =>
        HttpResponse.json({ appname: "wallabag", version: "2.6.9" }),
      ),
    );
    const r = await authedRequest<{ appname: string }>({
      method: "GET",
      path: "/api/info.json",
    });
    expect(r.appname).toBe("wallabag");
  });

  it("throws when no server URL is set", async () => {
    await expect(authedRequest<unknown>({ method: "GET", path: "/api/info.json" })).rejects.toThrow(
      /no server url/i,
    );
  });
});
