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
    expect(rows.map((r) => r.version)).toEqual([1, 2, 3, 4]);
  });

  it("is idempotent on repeat runs", async () => {
    await runMigrations(db);
    await runMigrations(db);
    const rows = await db.all<{ version: number }>(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    expect(rows.map((r) => r.version)).toEqual([1, 2, 3, 4]);
  });

  it("backfills backend_id from id for pre-existing rows", async () => {
    // Apply only migrations 1-3 to simulate an older install, seed a row,
    // then run all migrations and confirm 004 backfilled the column.
    db = await createBetterSqliteDriver(":memory:");
    await db.exec(`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
                   CREATE TABLE articles (id INTEGER PRIMARY KEY, title TEXT, url TEXT NOT NULL,
                     domain_name TEXT, content TEXT, preview_picture TEXT, reading_time INTEGER,
                     language TEXT, is_archived INTEGER NOT NULL DEFAULT 0,
                     is_starred INTEGER NOT NULL DEFAULT 0, created_at TEXT, updated_at TEXT,
                     starred_at TEXT, archived_at TEXT, published_at TEXT, published_by TEXT,
                     scroll_position REAL NOT NULL DEFAULT 0, server_updated_at TEXT,
                     local_updated_at TEXT, pending_op TEXT) STRICT;
                   CREATE TABLE tags (id INTEGER PRIMARY KEY, label TEXT NOT NULL, slug TEXT NOT NULL UNIQUE) STRICT;
                   CREATE TABLE annotations (id INTEGER PRIMARY KEY, article_id INTEGER NOT NULL,
                     quote TEXT NOT NULL, ranges_json TEXT NOT NULL, text TEXT,
                     created_at TEXT, updated_at TEXT, pending_op TEXT) STRICT;
                   INSERT INTO schema_migrations (version, applied_at) VALUES (1,'x'),(2,'x'),(3,'x');
                   INSERT INTO articles (id, url) VALUES (42, 'https://example.org');
                   INSERT INTO tags (id, label, slug) VALUES (7, 'go', 'go');
                   INSERT INTO annotations (id, article_id, quote, ranges_json) VALUES (99, 42, 'q', '[]');`);

    await runMigrations(db);

    const a = await db.get<{ backend_id: string }>("SELECT backend_id FROM articles WHERE id = 42");
    const t = await db.get<{ backend_id: string }>("SELECT backend_id FROM tags WHERE id = 7");
    const n = await db.get<{ backend_id: string }>(
      "SELECT backend_id FROM annotations WHERE id = 99",
    );
    expect(a?.backend_id).toBe("42");
    expect(t?.backend_id).toBe("7");
    expect(n?.backend_id).toBe("99");
  });
});
