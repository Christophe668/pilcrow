import { describe, it, expect, beforeEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../src/test/msw-server";

const secure = new Map<string, string>();
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (k: string) => secure.get(k) ?? null),
  setItemAsync: vi.fn(async (k: string, v: string) => void secure.set(k, v)),
  deleteItemAsync: vi.fn(async (k: string) => void secure.delete(k)),
}));

import { fetchInfo } from "@/api/info";

beforeEach(() => {
  secure.clear();
});

describe("fetchInfo", () => {
  it("hits /api/info.json without auth", async () => {
    server.use(
      http.get("https://wb.test/api/info.json", ({ request }) => {
        expect(request.headers.get("authorization")).toBeNull();
        return HttpResponse.json({ appname: "wallabag", version: "2.6.9" });
      }),
    );
    const r = await fetchInfo("https://wb.test");
    expect(r.appname).toBe("wallabag");
  });

  it("rejects when appname is not wallabag", async () => {
    server.use(
      http.get("https://wb.test/api/info.json", () =>
        HttpResponse.json({ appname: "something-else", version: "1.0" }),
      ),
    );
    await expect(fetchInfo("https://wb.test")).rejects.toThrow(/not a wallabag/i);
  });
});
