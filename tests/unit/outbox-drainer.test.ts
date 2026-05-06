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

import { drainOutbox } from "@/sync/outbox-drainer";
import { enqueue } from "@/db/repos/outbox";
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

describe("drainOutbox", () => {
  it("processes updateEntry success and clears row", async () => {
    await db.run("INSERT INTO articles (id, url, pending_op) VALUES (?, ?, 'update')", [
      9,
      "https://x",
    ]);
    await enqueue(db, "updateEntry", { id: 9, is_starred: 1 });

    server.use(
      http.patch("https://wb.test/api/entries/9.json", () =>
        HttpResponse.json({
          id: 9,
          title: "T",
          url: "https://x",
          domain_name: "x",
          content: null,
          preview_picture: null,
          reading_time: null,
          language: null,
          is_archived: 0,
          is_starred: 1,
          created_at: "2026-05-01",
          updated_at: "2026-05-06",
          starred_at: "2026-05-06",
          archived_at: null,
          published_at: null,
          published_by: null,
          tags: [],
        }),
      ),
    );

    const summary = await drainOutbox();
    expect(summary.processed).toBe(1);
    expect(summary.failed).toBe(0);

    const remaining = await db.all("SELECT * FROM outbox");
    expect(remaining.length).toBe(0);

    const row = await db.get<{ pending_op: string | null }>(
      "SELECT pending_op FROM articles WHERE id = 9",
    );
    expect(row?.pending_op).toBeNull();
  });

  it("retries on failure with backoff", async () => {
    await db.run("INSERT INTO articles (id, url, pending_op) VALUES (?, ?, 'update')", [
      9,
      "https://x",
    ]);
    await enqueue(db, "updateEntry", { id: 9, is_starred: 1 });

    server.use(
      http.patch("https://wb.test/api/entries/9.json", () =>
        HttpResponse.json({ error: "server error" }, { status: 500 }),
      ),
    );

    const summary = await drainOutbox();
    expect(summary.processed).toBe(0);
    expect(summary.failed).toBe(1);

    const row = await db.get<{ attempts: number; last_error: string | null }>(
      "SELECT attempts, last_error FROM outbox LIMIT 1",
    );
    expect(row?.attempts).toBe(1);
    expect(row?.last_error).toBeTruthy();
  });

  it("createEntry rewrites temp negative id to real id", async () => {
    await db.run("INSERT INTO articles (id, url, pending_op) VALUES (?, ?, 'create')", [
      -1,
      "https://example.com/post",
    ]);
    await enqueue(db, "createEntry", {
      tempId: -1,
      url: "https://example.com/post",
      tags: ["a"],
    });

    server.use(
      http.post("https://wb.test/api/entries.json", () =>
        HttpResponse.json({
          id: 999,
          title: "Post",
          url: "https://example.com/post",
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
        }),
      ),
    );

    const summary = await drainOutbox();
    expect(summary.processed).toBe(1);

    expect(await db.get("SELECT * FROM articles WHERE id = -1")).toBeNull();
    const real = await db.get<{ title: string }>("SELECT title FROM articles WHERE id = 999");
    expect(real?.title).toBe("Post");
  });
});
