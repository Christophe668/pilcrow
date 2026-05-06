import { describe, it, expect, beforeEach } from "vitest";
import { createBetterSqliteDriver } from "@/db/driver-better-sqlite3";
import { runMigrations } from "@/db/migrations";
import type { DbDriver } from "@/db/driver";

let db: DbDriver;

beforeEach(async () => {
  db = await createBetterSqliteDriver(":memory:");
});

describe("runMigrations", () => {
  it("creates all expected tables on first run", async () => {
    await runMigrations(db);
    const tables = await db.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    );
    const names = tables.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "articles",
        "tags",
        "article_tags",
        "annotations",
        "outbox",
        "sync_state",
        "schema_migrations",
      ]),
    );
  });

  it("records applied versions", async () => {
    await runMigrations(db);
    const rows = await db.all<{ version: number }>(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    expect(rows.map((r) => r.version)).toEqual([1]);
  });

  it("is idempotent on repeat runs", async () => {
    await runMigrations(db);
    await runMigrations(db);
    const rows = await db.all<{ version: number }>(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    expect(rows.map((r) => r.version)).toEqual([1]);
  });
});
