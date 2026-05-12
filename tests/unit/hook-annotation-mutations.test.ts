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
import { createAnnotationAction } from "@/hooks/useCreateAnnotation";
import { updateAnnotationAction } from "@/hooks/useUpdateAnnotation";
import { deleteAnnotationAction } from "@/hooks/useDeleteAnnotation";

let db: DbDriver;

beforeEach(async () => {
  secure.clear();
  asyncMem.clear();
  db = await createBetterSqliteDriver(":memory:");
  await runMigrations(db);
  await db.run("INSERT INTO articles (id, url) VALUES (1, 'https://x')");
  setDbForTesting(db);
});

const ranges = [{ start: "/p[1]", startOffset: 0, end: "/p[1]", endOffset: 5 }];

describe("createAnnotationAction", () => {
  it("inserts a row with negative tempId and pending_op='create'", async () => {
    const id = await createAnnotationAction({
      articleId: 1,
      quote: "hello",
      ranges,
      text: "first note",
    });
    expect(id).toBeLessThan(0);
    const row = await db.get<{
      id: number;
      article_id: number;
      quote: string;
      ranges_json: string;
      text: string | null;
      pending_op: string | null;
    }>(
      "SELECT id, article_id, quote, ranges_json, text, pending_op FROM annotations WHERE id = ?",
      [id],
    );
    expect(row?.article_id).toBe(1);
    expect(row?.quote).toBe("hello");
    expect(JSON.parse(row!.ranges_json)).toEqual(ranges);
    expect(row?.text).toBe("first note");
    expect(row?.pending_op).toBe("create");
  });

  it("enqueues createAnnotation with tempId, entryId, quote, ranges, text", async () => {
    const id = await createAnnotationAction({
      articleId: 1,
      quote: "hello",
      ranges,
      text: null,
    });
    const job = await db.get<{ op: string; payload_json: string }>(
      "SELECT op, payload_json FROM outbox LIMIT 1",
    );
    expect(job?.op).toBe("createAnnotation");
    expect(JSON.parse(job!.payload_json)).toEqual({
      tempId: id,
      entryId: 1,
      quote: "hello",
      ranges,
      text: null,
    });
  });
});

describe("updateAnnotationAction", () => {
  it("updates text + sets pending_op='update' + enqueues", async () => {
    await db.run(
      `INSERT INTO annotations (id, article_id, quote, ranges_json, text, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [42, 1, "x", JSON.stringify(ranges), "old", "2026-05-01", "2026-05-01"],
    );
    await updateAnnotationAction(42, "new note");
    const row = await db.get<{ text: string; pending_op: string }>(
      "SELECT text, pending_op FROM annotations WHERE id = 42",
    );
    expect(row?.text).toBe("new note");
    expect(row?.pending_op).toBe("update");
    const job = await db.get<{ op: string; payload_json: string }>(
      "SELECT op, payload_json FROM outbox LIMIT 1",
    );
    expect(job?.op).toBe("updateAnnotation");
    expect(JSON.parse(job!.payload_json)).toEqual({ id: 42, text: "new note" });
  });
});

describe("deleteAnnotationAction", () => {
  it("marks delete + enqueues; row stays pending_op='delete' until drained", async () => {
    await db.run(
      `INSERT INTO annotations (id, article_id, quote, ranges_json, text, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [42, 1, "x", JSON.stringify(ranges), null, "2026-05-01", "2026-05-01"],
    );
    await deleteAnnotationAction(42);
    const row = await db.get<{ pending_op: string }>(
      "SELECT pending_op FROM annotations WHERE id = 42",
    );
    expect(row?.pending_op).toBe("delete");
    const job = await db.get<{ op: string; payload_json: string }>(
      "SELECT op, payload_json FROM outbox LIMIT 1",
    );
    expect(job?.op).toBe("deleteAnnotation");
    expect(JSON.parse(job!.payload_json)).toEqual({ id: 42 });
  });
});
