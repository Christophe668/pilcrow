import { describe, it, expect, beforeEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../src/test/msw-server";

const secure = new Map<string, string>();
const asyncMem = new Map<string, string>();
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (k: string) => secure.get(k) ?? null),
  setItemAsync: vi.fn(async (k: string, v: string) => void secure.set(k, v)),
  deleteItemAsync: vi.fn(async (k: string) => void secure.delete(k)),
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (k: string) => asyncMem.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => void asyncMem.set(k, v)),
    removeItem: vi.fn(async (k: string) => void asyncMem.delete(k)),
  },
}));

import { listTags, addTagsToEntry, removeTagFromEntry } from "@/api/tags";
import { applyTokenBundle } from "@/auth/tokens";

beforeEach(async () => {
  secure.clear();
  asyncMem.clear();
  secure.set("wb_client_id", "cid");
  secure.set("wb_client_secret", "cs");
  asyncMem.set("wb:server_url", "https://wb.test");
  await applyTokenBundle({
    access_token: "at",
    refresh_token: "rt",
    expires_in: 3600,
    token_type: "bearer",
  });
});

describe("tags API", () => {
  it("listTags returns all", async () => {
    server.use(
      http.get("https://wb.test/api/tags.json", () =>
        HttpResponse.json([
          { id: 1, label: "foo", slug: "foo" },
          { id: 2, label: "bar", slug: "bar" },
        ]),
      ),
    );
    const t = await listTags();
    expect(t.map((x) => x.id)).toEqual([1, 2]);
  });

  it("addTagsToEntry posts comma-joined", async () => {
    let body: unknown;
    server.use(
      http.post("https://wb.test/api/entries/9/tags.json", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: 9, tags: [{ id: 1, label: "foo", slug: "foo" }] });
      }),
    );
    await addTagsToEntry(9, ["foo", "bar"]);
    expect(body).toEqual({ tags: "foo,bar" });
  });

  it("removeTagFromEntry deletes /api/entries/{id}/tags/{tagId}.json", async () => {
    let called = false;
    server.use(
      http.delete("https://wb.test/api/entries/9/tags/3.json", () => {
        called = true;
        return HttpResponse.json({ ok: true });
      }),
    );
    await removeTagFromEntry(9, 3);
    expect(called).toBe(true);
  });
});
