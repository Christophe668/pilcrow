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

import { runIncrementalSync } from "@/sync/engine";
import { backfillMissingContent } from "@/sync/content-backfill";
import { setSyncValue } from "@/db/repos/sync-state";
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

const entry = (id: number, content: string | null) => ({
  id,
  title: `T${id}`,
  url: `https://x/${id}`,
  domain_name: "x",
  content,
  preview_picture: null,
  reading_time: null,
  language: null,
  is_archived: 0 as const,
  is_starred: 0 as const,
  created_at: "2026-05-01T00:00:00Z",
  updated_at: "2026-05-10T00:00:00Z",
  starred_at: null,
  archived_at: null,
  published_at: null,
  published_by: null,
  tags: [],
});

async function insertRow(id: number, content: string | null, createdAt = "2026-05-01T00:00:00Z") {
  await db.run(
    `INSERT INTO articles (id, backend_id, url, title, content, created_at, is_archived)
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
    [id, String(id), `https://x/${id}`, `T${id}`, content, createdAt],
  );
}

describe("incremental sync content preservation", () => {
  it("does not wipe an existing body when the list payload has content: null", async () => {
    await insertRow(50, "<p>saved body</p>");
    await setSyncValue(db, "last_since", "1700000000");
    server.use(
      http.get("https://wb.test/api/entries.json", () =>
        HttpResponse.json({
          page: 1,
          pages: 1,
          limit: 100,
          total: 1,
          _embedded: { items: [entry(50, null)] },
        }),
      ),
      http.get("https://wb.test/api/tags.json", () => HttpResponse.json([])),
    );

    await runIncrementalSync();

    const a = await db.get<{ content: string | null; title: string }>(
      "SELECT content, title FROM articles WHERE id = 50",
    );
    expect(a?.content).toBe("<p>saved body</p>");
    expect(a?.title).toBe("T50"); // other fields still updated
  });
});

describe("backfillMissingContent", () => {
  it("downloads bodies for rows missing content and leaves filled rows alone", async () => {
    await insertRow(1, null);
    await insertRow(2, "<p>already here</p>");
    const fetchedIds: string[] = [];
    server.use(
      http.get("https://wb.test/api/entries/:id.json", ({ params }) => {
        fetchedIds.push(String(params.id));
        return HttpResponse.json(entry(Number(params.id), `<p>body ${String(params.id)}</p>`));
      }),
    );

    const result = await backfillMissingContent();

    expect(result.fetched).toBe(1);
    expect(result.failed).toBe(0);
    expect(fetchedIds).toEqual(["1"]);
    const a = await db.get<{ content: string | null }>("SELECT content FROM articles WHERE id = 1");
    expect(a?.content).toBe("<p>body 1</p>");
  });

  it("continues past individual failures", async () => {
    await insertRow(1, null);
    await insertRow(2, null);
    server.use(
      http.get("https://wb.test/api/entries/1.json", () =>
        HttpResponse.json({ error: "boom" }, { status: 500 }),
      ),
      http.get("https://wb.test/api/entries/2.json", () =>
        HttpResponse.json(entry(2, "<p>body 2</p>")),
      ),
    );

    const result = await backfillMissingContent();

    expect(result.fetched).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.aborted).toBe(false);
    const a = await db.get<{ content: string | null }>("SELECT content FROM articles WHERE id = 2");
    expect(a?.content).toBe("<p>body 2</p>");
  });

  it("aborts the sweep after repeated consecutive failures", async () => {
    for (let i = 1; i <= 30; i++) await insertRow(i, null);
    let requests = 0;
    server.use(
      http.get("https://wb.test/api/entries/:id.json", () => {
        requests += 1;
        return HttpResponse.json({ error: "down" }, { status: 500 });
      }),
    );

    const result = await backfillMissingContent();

    expect(result.aborted).toBe(true);
    expect(result.fetched).toBe(0);
    // Should stop well before exhausting all 30 rows.
    expect(requests).toBeLessThan(30);
  });

  it("skips deleted-pending rows and rows without a backend id", async () => {
    await insertRow(1, null);
    await db.run("UPDATE articles SET pending_op = 'delete' WHERE id = 1");
    await db.run(
      "INSERT INTO articles (id, backend_id, url, title, content) VALUES (2, NULL, 'https://x/2', 'local', NULL)",
    );
    let requests = 0;
    server.use(
      http.get("https://wb.test/api/entries/:id.json", () => {
        requests += 1;
        return HttpResponse.json(entry(1, "<p>x</p>"));
      }),
    );

    const result = await backfillMissingContent();

    expect(requests).toBe(0);
    expect(result.fetched).toBe(0);
  });
});
