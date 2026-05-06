import { describe, it, expect, beforeEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../src/test/msw-server";
import { createBetterSqliteDriver } from "@/db/driver-better-sqlite3";
import { runMigrations } from "@/db/migrations";
import type { DbDriver } from "@/db/driver";

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

import { runInitialSync } from "@/sync/engine";
import { setDbForTesting } from "@/db";
import { applyTokenBundle } from "@/auth/tokens";

let db: DbDriver;

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
  db = await createBetterSqliteDriver(":memory:");
  await runMigrations(db);
  setDbForTesting(db);
});

const entry = (over: {
  id: number;
  updated_at?: string;
  tags?: { id: number; label: string; slug: string }[];
}) => ({
  id: over.id,
  title: `T${over.id}`,
  url: `https://x/${over.id}`,
  domain_name: "x",
  content: null,
  preview_picture: null,
  reading_time: null,
  language: null,
  is_archived: 0 as const,
  is_starred: 0 as const,
  created_at: "2026-05-01T00:00:00Z",
  updated_at: over.updated_at ?? "2026-05-02T00:00:00Z",
  starred_at: null,
  archived_at: null,
  published_at: null,
  published_by: null,
  tags: over.tags ?? [],
});

describe("runInitialSync", () => {
  it("paginates until pages == 0 and writes articles + tags", async () => {
    let pageHits = 0;
    server.use(
      http.get("https://wb.test/api/entries.json", ({ request }) => {
        const u = new URL(request.url);
        const page = Number(u.searchParams.get("page"));
        pageHits++;
        if (page === 1) {
          return HttpResponse.json({
            page: 1,
            pages: 2,
            limit: 100,
            total: 3,
            _embedded: {
              items: [
                entry({ id: 1, tags: [{ id: 10, label: "Foo", slug: "foo" }] }),
                entry({ id: 2 }),
              ],
            },
          });
        }
        return HttpResponse.json({
          page: 2,
          pages: 2,
          limit: 100,
          total: 3,
          _embedded: { items: [entry({ id: 3 })] },
        });
      }),
      http.get("https://wb.test/api/tags.json", () =>
        HttpResponse.json([{ id: 10, label: "Foo", slug: "foo" }]),
      ),
    );

    await runInitialSync();

    expect(pageHits).toBe(2);
    const articles = await db.all<{ id: number }>("SELECT id FROM articles ORDER BY id");
    expect(articles.map((a) => a.id)).toEqual([1, 2, 3]);

    const tags = await db.all<{ slug: string }>("SELECT slug FROM tags");
    expect(tags.map((t) => t.slug)).toEqual(["foo"]);

    const link = await db.all<{ article_id: number; tag_id: number }>(
      "SELECT article_id, tag_id FROM article_tags",
    );
    expect(link).toEqual([{ article_id: 1, tag_id: 10 }]);
  });
});
