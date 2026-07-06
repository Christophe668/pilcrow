import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../src/test/msw-server";
import { createBetterSqliteDriver } from "@/db/driver-better-sqlite3";
import { runMigrations } from "@/db/migrations";
import type { DbDriver } from "@/db/driver";

import { runInitialSync, runIncrementalSync } from "@/sync/engine";
import { setSyncValue, getSyncValue } from "@/db/repos/sync-state";
import { enqueue } from "@/db/repos/outbox";
import { setDbForTesting } from "@/db";
import { setActiveBackend } from "@/api/backend";
import { applyTokenBundle } from "@/auth/tokens";

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

const entry = (id: number) => ({
  id,
  title: `T${id}`,
  url: `https://x/${id}`,
  domain_name: "x",
  content: null,
  preview_picture: null,
  reading_time: null,
  language: null,
  is_archived: 0 as const,
  is_starred: 0 as const,
  created_at: "2026-05-01T00:00:00Z",
  updated_at: "2026-05-02T00:00:00Z",
  starred_at: null,
  archived_at: null,
  published_at: null,
  published_by: null,
  tags: [],
});

const pageOf = (items: unknown[]) =>
  HttpResponse.json({
    page: 1,
    pages: 1,
    limit: 100,
    total: items.length,
    _embedded: { items },
  });

async function insertArticle(a: {
  id: number;
  backendId: string | null;
  pendingOp?: string;
}): Promise<void> {
  await db.run(
    "INSERT INTO articles (id, backend_id, url, title, updated_at, pending_op) VALUES (?, ?, ?, ?, ?, ?)",
    [
      a.id,
      a.backendId,
      `https://x/${a.id}`,
      `T${a.id}`,
      "2026-04-01T00:00:00Z",
      a.pendingOp ?? null,
    ],
  );
}

async function localArticleIds(): Promise<number[]> {
  const rows = await db.all<{ id: number }>("SELECT id FROM articles ORDER BY id");
  return rows.map((r) => r.id);
}

describe("delete propagation (wallabag)", () => {
  it("initial sync removes local articles no longer on the server", async () => {
    await insertArticle({ id: 50, backendId: "50" });
    await insertArticle({ id: 99, backendId: "99" });
    server.use(
      http.get("https://wb.test/api/entries.json", () => pageOf([entry(50)])),
      http.get("https://wb.test/api/tags.json", () => HttpResponse.json([])),
    );

    await runInitialSync();

    expect(await localArticleIds()).toEqual([50]);
  });

  it("incremental sync runs a full sweep and prunes deleted articles", async () => {
    await insertArticle({ id: 1, backendId: "1" });
    await insertArticle({ id: 2, backendId: "2" });
    await setSyncValue(db, "last_since", "1700000000");
    let sweepHits = 0;
    server.use(
      http.get("https://wb.test/api/entries.json", ({ request }) => {
        const since = new URL(request.url).searchParams.get("since");
        // The incremental fetch carries `since`; the sweep re-lists
        // everything without it.
        if (since === null) sweepHits++;
        return pageOf([entry(1)]);
      }),
      http.get("https://wb.test/api/tags.json", () => HttpResponse.json([])),
    );

    await runIncrementalSync();

    expect(sweepHits).toBe(1);
    expect(await localArticleIds()).toEqual([1]);
    expect(await getSyncValue(db, "last_delete_sweep_at")).toBeTruthy();
  });

  it("skips the sweep when the last one is recent", async () => {
    await insertArticle({ id: 1, backendId: "1" });
    await insertArticle({ id: 2, backendId: "2" });
    await setSyncValue(db, "last_since", "1700000000");
    await setSyncValue(db, "last_delete_sweep_at", new Date().toISOString());
    let sweepHits = 0;
    server.use(
      http.get("https://wb.test/api/entries.json", ({ request }) => {
        const since = new URL(request.url).searchParams.get("since");
        if (since === null) sweepHits++;
        return pageOf([entry(1)]);
      }),
      http.get("https://wb.test/api/tags.json", () => HttpResponse.json([])),
    );

    await runIncrementalSync();

    expect(sweepHits).toBe(0);
    expect(await localArticleIds()).toEqual([1, 2]);
  });

  it("never deletes rows with pending ops, outbox references, or no backend_id", async () => {
    await insertArticle({ id: 10, backendId: "10", pendingOp: "update" });
    await insertArticle({ id: 11, backendId: null });
    await insertArticle({ id: 12, backendId: "12" });
    await insertArticle({ id: 13, backendId: "13" });
    await enqueue(db, "addTag", { entryId: 12, labels: ["x"] });
    server.use(
      http.get("https://wb.test/api/entries.json", () => pageOf([])),
      http.get("https://wb.test/api/tags.json", () => HttpResponse.json([])),
    );

    await runInitialSync();

    expect(await localArticleIds()).toEqual([10, 11, 12]);
  });

  it("prunes tags deleted server-side, cascading their article links", async () => {
    await insertArticle({ id: 1, backendId: "1" });
    await db.run("INSERT INTO tags (id, backend_id, label, slug) VALUES (10, '10', 'Foo', 'foo')");
    await db.run("INSERT INTO tags (id, backend_id, label, slug) VALUES (11, '11', 'Bar', 'bar')");
    await db.run("INSERT INTO article_tags (article_id, tag_id) VALUES (1, 11)");
    server.use(
      http.get("https://wb.test/api/entries.json", () => pageOf([entry(1)])),
      http.get("https://wb.test/api/tags.json", () =>
        HttpResponse.json([{ id: 10, label: "Foo", slug: "foo" }]),
      ),
    );

    await runInitialSync();

    const tags = await db.all<{ slug: string }>("SELECT slug FROM tags ORDER BY slug");
    expect(tags).toEqual([{ slug: "foo" }]);
    expect(await db.all("SELECT * FROM article_tags")).toEqual([]);
  });

  it("keeps tags referenced by a pending removeTag op", async () => {
    await insertArticle({ id: 1, backendId: "1" });
    await db.run("INSERT INTO tags (id, backend_id, label, slug) VALUES (11, '11', 'Bar', 'bar')");
    await db.run("INSERT INTO tags (id, backend_id, label, slug) VALUES (12, '12', 'Baz', 'baz')");
    await enqueue(db, "removeTag", { entryId: 1, tagId: 11 });
    server.use(
      http.get("https://wb.test/api/entries.json", () => pageOf([entry(1)])),
      http.get("https://wb.test/api/tags.json", () => HttpResponse.json([])),
    );

    await runInitialSync();

    const tags = await db.all<{ id: number }>("SELECT id FROM tags ORDER BY id");
    expect(tags).toEqual([{ id: 11 }]);
  });
});

describe("delete propagation (readeck)", () => {
  beforeEach(() => {
    asyncMem.set("wb:server_url", "https://rd.test");
    secure.set("wb_access_token", "TOKEN");
    setActiveBackend("readeck");
  });

  afterEach(() => {
    setActiveBackend("wallabag");
  });

  const emptyList = () =>
    HttpResponse.json([], { headers: { "Total-Count": "0", "Current-Page": "1" } });

  it("applies delete entries from the change log and advances the cursor", async () => {
    await insertArticle({ id: 1, backendId: "aaa" });
    await insertArticle({ id: 2, backendId: "bbb" });
    await setSyncValue(db, "changes_since", "2026-06-01T00:00:00Z");
    let capturedSince: string | null = null;
    server.use(
      http.get("https://rd.test/api/bookmarks", () => emptyList()),
      http.get("https://rd.test/api/bookmarks/labels", () => HttpResponse.json([])),
      http.get("https://rd.test/api/bookmarks/sync", ({ request }) => {
        capturedSince = new URL(request.url).searchParams.get("since");
        return HttpResponse.json([{ id: "bbb", time: "2026-06-02T00:00:00Z", type: "delete" }]);
      }),
    );

    await runIncrementalSync();

    expect(capturedSince).toBe("2026-06-01T00:00:00Z");
    expect(await localArticleIds()).toEqual([1]);
    expect(await getSyncValue(db, "changes_since")).toBe("2026-06-02T00:00:00Z");
  });

  it("bootstraps without a cursor by diffing the existence snapshot", async () => {
    await insertArticle({ id: 1, backendId: "aaa" });
    await insertArticle({ id: 2, backendId: "bbb" });
    await insertArticle({ id: 3, backendId: "ccc" });
    let capturedSince: string | null = "unset";
    server.use(
      http.get("https://rd.test/api/bookmarks", () => emptyList()),
      http.get("https://rd.test/api/bookmarks/labels", () => HttpResponse.json([])),
      http.get("https://rd.test/api/bookmarks/sync", ({ request }) => {
        capturedSince = new URL(request.url).searchParams.get("since");
        return HttpResponse.json([
          { id: "aaa", time: "2026-06-01T05:00:00Z", type: "update" },
          { id: "bbb", time: "2026-06-01T06:00:00Z", type: "update" },
        ]);
      }),
    );

    await runIncrementalSync();

    expect(capturedSince).toBeNull();
    expect(await localArticleIds()).toEqual([1, 2]);
    expect(await getSyncValue(db, "changes_since")).toBe("2026-06-01T06:00:00Z");
  });

  it("keeps articles with pending outbox ops even when the log deletes them", async () => {
    await insertArticle({ id: 1, backendId: "aaa" });
    await insertArticle({ id: 2, backendId: "bbb", pendingOp: "update" });
    await setSyncValue(db, "changes_since", "2026-06-01T00:00:00Z");
    server.use(
      http.get("https://rd.test/api/bookmarks", () => emptyList()),
      http.get("https://rd.test/api/bookmarks/labels", () => HttpResponse.json([])),
      http.get("https://rd.test/api/bookmarks/sync", () =>
        HttpResponse.json([{ id: "bbb", time: "2026-06-02T00:00:00Z", type: "delete" }]),
      ),
    );

    await runIncrementalSync();

    expect(await localArticleIds()).toEqual([1, 2]);
  });
});
