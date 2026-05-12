import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { createBetterSqliteDriver } from "@/db/driver-better-sqlite3";
import { runMigrations } from "@/db/migrations";
import type { DbDriver } from "@/db/driver";
import { enqueue, peekDue, markFailure, markSuccess, type OutboxOp } from "@/db/repos/outbox";

let db: DbDriver;

beforeEach(async () => {
  db = await createBetterSqliteDriver(":memory:");
  await runMigrations(db);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("outbox repo", () => {
  it("enqueue stores op + payload", async () => {
    await enqueue(db, "updateEntry", { id: 5, is_starred: true });
    const due = await peekDue(db, 10);
    expect(due).toHaveLength(1);
    expect(due[0]?.op).toBe<OutboxOp>("updateEntry");
    expect(JSON.parse(due[0]!.payload_json)).toEqual({ id: 5, is_starred: true });
  });

  it("markFailure increments attempts and pushes next_attempt_at out", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-06T12:00:00Z"));
    await enqueue(db, "updateEntry", { id: 5 });
    const [row] = await peekDue(db, 10);
    await markFailure(db, row!.id, "boom");
    const next = await db.get<{ attempts: number; next_attempt_at: string; last_error: string }>(
      "SELECT attempts, next_attempt_at, last_error FROM outbox WHERE id = ?",
      [row!.id],
    );
    expect(next?.attempts).toBe(1);
    expect(next?.last_error).toBe("boom");
    expect(new Date(next!.next_attempt_at).getTime()).toBeGreaterThan(
      new Date("2026-05-06T12:00:00Z").getTime(),
    );
  });

  it("peekDue ignores rows with future next_attempt_at", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-06T12:00:00Z"));
    await enqueue(db, "updateEntry", { id: 5 });
    const [row] = await peekDue(db, 10);
    await markFailure(db, row!.id, "boom");
    expect(await peekDue(db, 10)).toEqual([]);
    vi.setSystemTime(new Date("2026-05-06T13:00:00Z"));
    expect((await peekDue(db, 10)).length).toBe(1);
  });

  it("markSuccess removes the row", async () => {
    await enqueue(db, "updateEntry", { id: 5 });
    const [row] = await peekDue(db, 10);
    await markSuccess(db, row!.id);
    expect(await peekDue(db, 10)).toEqual([]);
  });
});
