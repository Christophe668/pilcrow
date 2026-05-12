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

import { listEntries, getEntry, createEntry, updateEntry, deleteEntry } from "@/api/entries";
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

describe("listEntries", () => {
  it("paginates with detail=metadata", async () => {
    server.use(
      http.get("https://wb.test/api/entries.json", ({ request }) => {
        const u = new URL(request.url);
        expect(u.searchParams.get("detail")).toBe("metadata");
        expect(u.searchParams.get("page")).toBe("1");
        expect(u.searchParams.get("perPage")).toBe("100");
        return HttpResponse.json({
          page: 1,
          pages: 1,
          limit: 100,
          total: 1,
          _embedded: {
            items: [
              {
                id: 1,
                title: "T",
                url: "https://x",
                domain_name: "x",
                content: null,
                preview_picture: null,
                reading_time: null,
                language: null,
                is_archived: 0,
                is_starred: 0,
                created_at: "2026-05-01",
                updated_at: "2026-05-02",
                starred_at: null,
                archived_at: null,
                published_at: null,
                published_by: null,
                tags: [],
              },
            ],
          },
        });
      }),
    );
    const r = await listEntries({ page: 1, perPage: 100, detail: "metadata" });
    expect(r._embedded.items[0]?.id).toBe(1);
  });

  it("forwards since= for incremental sync", async () => {
    let captured: string | null = null;
    server.use(
      http.get("https://wb.test/api/entries.json", ({ request }) => {
        captured = new URL(request.url).searchParams.get("since");
        return HttpResponse.json({
          page: 1,
          pages: 0,
          limit: 100,
          total: 0,
          _embedded: { items: [] },
        });
      }),
    );
    await listEntries({ page: 1, perPage: 100, detail: "full", since: 12345 });
    expect(captured).toBe("12345");
  });
});

describe("getEntry / createEntry / updateEntry / deleteEntry", () => {
  it("getEntry hits /api/entries/{id}.json", async () => {
    server.use(
      http.get("https://wb.test/api/entries/9.json", () =>
        HttpResponse.json({
          id: 9,
          title: "Nine",
          url: "https://x",
          domain_name: "x",
          content: "<p>hi</p>",
          preview_picture: null,
          reading_time: 1,
          language: "en",
          is_archived: 0,
          is_starred: 0,
          created_at: "2026-05-01",
          updated_at: "2026-05-02",
          starred_at: null,
          archived_at: null,
          published_at: null,
          published_by: null,
          tags: [],
        }),
      ),
    );
    const e = await getEntry(9);
    expect(e.title).toBe("Nine");
  });

  it("createEntry posts JSON {url, tags}", async () => {
    server.use(
      http.post("https://wb.test/api/entries.json", async ({ request }) => {
        const body = (await request.json()) as { url: string; tags?: string };
        expect(body.url).toBe("https://example.com/post");
        expect(body.tags).toBe("a,b");
        return HttpResponse.json({
          id: 99,
          title: null,
          url: body.url,
          domain_name: "example.com",
          content: null,
          preview_picture: null,
          reading_time: null,
          language: null,
          is_archived: 0,
          is_starred: 0,
          created_at: "2026-05-06",
          updated_at: "2026-05-06",
          starred_at: null,
          archived_at: null,
          published_at: null,
          published_by: null,
          tags: [],
        });
      }),
    );
    const r = await createEntry("https://example.com/post", ["a", "b"]);
    expect(r.id).toBe(99);
  });

  it("updateEntry PATCHes is_starred / is_archived (sends archive/starred)", async () => {
    let body: unknown;
    server.use(
      http.patch("https://wb.test/api/entries/5.json", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          id: 5,
          title: "T",
          url: "https://x",
          domain_name: "x",
          content: null,
          preview_picture: null,
          reading_time: null,
          language: null,
          is_archived: 1,
          is_starred: 1,
          created_at: "2026-05-01",
          updated_at: "2026-05-02",
          starred_at: "2026-05-02",
          archived_at: "2026-05-02",
          published_at: null,
          published_by: null,
          tags: [],
        });
      }),
    );
    await updateEntry(5, { is_starred: 1, is_archived: 1 });
    expect(body).toEqual({ archive: 1, starred: 1 });
  });

  it("deleteEntry sends DELETE /api/entries/{id}.json", async () => {
    let called = false;
    server.use(
      http.delete("https://wb.test/api/entries/7.json", () => {
        called = true;
        return HttpResponse.json({ ok: true });
      }),
    );
    await deleteEntry(7);
    expect(called).toBe(true);
  });
});
