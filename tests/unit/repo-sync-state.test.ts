import { describe, it, expect, beforeEach } from "vitest";
import { createBetterSqliteDriver } from "@/db/driver-better-sqlite3";
import { runMigrations } from "@/db/migrations";
import type { DbDriver } from "@/db/driver";
import { getSyncValue, setSyncValue } from "@/db/repos/sync-state";

let db: DbDriver;

beforeEach(async () => {
  db = await createBetterSqliteDriver(":memory:");
  await runMigrations(db);
});

describe("sync-state repo", () => {
  it("returns null for missing key", async () => {
    expect(await getSyncValue(db, "last_since")).toBeNull();
  });

  it("round-trips a value", async () => {
    await setSyncValue(db, "last_since", "1000");
    expect(await getSyncValue(db, "last_since")).toBe("1000");
  });

  it("overwrites existing value", async () => {
    await setSyncValue(db, "last_since", "1000");
    await setSyncValue(db, "last_since", "2000");
    expect(await getSyncValue(db, "last_since")).toBe("2000");
  });
});
