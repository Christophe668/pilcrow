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
import { createEntryAction } from "@/hooks/useCreateEntry";

let db: DbDriver;

beforeEach(async () => {
  secure.clear();
  asyncMem.clear();
  db = await createBetterSqliteDriver(":memory:");
  await runMigrations(db);
  setDbForTesting(db);
});

describe("createEntryAction", () => {
  it("inserts a temp negative id with pending_op='create'", async () => {
    const id = await createEntryAction("https://example.com/post");
    expect(id).toBeLessThan(0);
    const row = await db.get<{
      id: number;
      url: string;
      pending_op: string | null;
      title: string | null;
    }>("SELECT id, url, pending_op, title FROM articles WHERE id = ?", [id]);
    expect(row?.id).toBe(id);
    expect(row?.url).toBe("https://example.com/post");
    expect(row?.pending_op).toBe("create");
    expect(row?.title).toBe("https://example.com/post");
  });

  it("enqueues createEntry with tempId, url, and tags", async () => {
    const id = await createEntryAction("https://example.com/post", ["a", "b"]);
    const job = await db.get<{ op: string; payload_json: string }>(
      "SELECT op, payload_json FROM outbox LIMIT 1",
    );
    expect(job?.op).toBe("createEntry");
    expect(JSON.parse(job!.payload_json)).toEqual({
      tempId: id,
      url: "https://example.com/post",
      tags: ["a", "b"],
    });
  });

  it("omits tags from the payload when empty", async () => {
    await createEntryAction("https://example.com/post");
    const job = await db.get<{ payload_json: string }>("SELECT payload_json FROM outbox LIMIT 1");
    const payload = JSON.parse(job!.payload_json) as { tags?: unknown };
    expect(payload.tags).toBeUndefined();
  });

  it("two consecutive creates produce distinct temp ids", async () => {
    const a = await createEntryAction("https://example.com/a");
    const b = await createEntryAction("https://example.com/b");
    expect(a).not.toBe(b);
    expect(a).toBeLessThan(0);
    expect(b).toBeLessThan(0);
  });
});
