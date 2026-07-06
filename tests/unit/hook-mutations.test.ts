import { describe, it, expect, beforeEach, vi } from "vitest";
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

import { setDbForTesting } from "@/db";
import { toggleStarredAction } from "@/hooks/useToggleStarred";
import { toggleArchivedAction } from "@/hooks/useToggleArchived";
import { deleteArticleAction } from "@/hooks/useDeleteArticle";

let db: DbDriver;

beforeEach(async () => {
  secure.clear();
  asyncMem.clear();
  db = await createBetterSqliteDriver(":memory:");
  await runMigrations(db);
  await db.run("INSERT INTO articles (id, url, is_starred, is_archived) VALUES (?, ?, 0, 0)", [
    9,
    "https://x",
  ]);
  setDbForTesting(db);
});

describe("toggleStarredAction", () => {
  it("toggles is_starred and enqueues updateEntry", async () => {
    await toggleStarredAction(9, true);
    const a = await db.get<{ is_starred: number; pending_op: string }>(
      "SELECT is_starred, pending_op FROM articles WHERE id = 9",
    );
    expect(a?.is_starred).toBe(1);
    expect(a?.pending_op).toBe("update");
    const job = await db.get<{ op: string; payload_json: string }>(
      "SELECT op, payload_json FROM outbox LIMIT 1",
    );
    expect(job?.op).toBe("updateEntry");
    expect(JSON.parse(job!.payload_json)).toEqual({ id: 9, is_starred: 1 });
  });
});

describe("toggleArchivedAction", () => {
  it("toggles is_archived and enqueues updateEntry", async () => {
    await toggleArchivedAction(9, true);
    const a = await db.get<{ is_archived: number }>(
      "SELECT is_archived FROM articles WHERE id = 9",
    );
    expect(a?.is_archived).toBe(1);
    const job = await db.get<{ payload_json: string }>("SELECT payload_json FROM outbox LIMIT 1");
    expect(JSON.parse(job!.payload_json)).toEqual({ id: 9, is_archived: 1 });
  });
});

describe("deleteArticleAction", () => {
  it("removes locally and enqueues deleteEntry carrying the backend id", async () => {
    await db.run("UPDATE articles SET backend_id = '9' WHERE id = 9");
    await deleteArticleAction(9);
    const a = await db.get("SELECT * FROM articles WHERE id = 9");
    expect(a).toBeNull();
    const job = await db.get<{ op: string; payload_json: string }>(
      "SELECT op, payload_json FROM outbox LIMIT 1",
    );
    expect(job?.op).toBe("deleteEntry");
    // The local row is gone by drain time, so the payload must carry the
    // backend id along.
    expect(JSON.parse(job!.payload_json)).toEqual({ id: 9, backendId: "9" });
  });

  it("cancels the queued create instead of enqueueing a delete for never-synced rows", async () => {
    // Row 9 has no backend_id (offline save whose createEntry hasn't drained).
    await db.run("INSERT INTO outbox (op, payload_json, created_at) VALUES (?, ?, ?)", [
      "createEntry",
      JSON.stringify({ tempId: 9, url: "https://x" }),
      new Date().toISOString(),
    ]);
    await deleteArticleAction(9);
    const a = await db.get("SELECT * FROM articles WHERE id = 9");
    expect(a).toBeNull();
    const jobs = await db.all<{ op: string }>("SELECT op FROM outbox");
    expect(jobs).toEqual([]);
  });
});
