import { describe, it, expect, beforeEach } from "vitest";
import { createBetterSqliteDriver } from "@/db/driver-better-sqlite3";
import { runMigrations } from "@/db/migrations";
import type { DbDriver } from "@/db/driver";

let db: DbDriver;

beforeEach(async () => {
  db = await createBetterSqliteDriver(":memory:");
  await runMigrations(db);
});

describe("FTS5 migration", () => {
  it("creates the articles_fts virtual table", async () => {
    const row = await db.get<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'articles_fts'",
    );
    expect(row?.name).toBe("articles_fts");
  });

  it("inserting an article populates FTS via trigger", async () => {
    await db.run("INSERT INTO articles (id, url, title, content) VALUES (?, ?, ?, ?)", [
      1,
      "https://x",
      "Hello world",
      "Body text about cats",
    ]);
    const r = await db.all<{ id: number }>(
      "SELECT rowid AS id FROM articles_fts WHERE articles_fts MATCH ?",
      ["cats"],
    );
    expect(r).toEqual([{ id: 1 }]);
  });

  it("updating an article updates FTS via trigger", async () => {
    await db.run("INSERT INTO articles (id, url, title, content) VALUES (?, ?, ?, ?)", [
      1,
      "https://x",
      "Hello",
      "first",
    ]);
    await db.run("UPDATE articles SET content = ? WHERE id = ?", ["second body", 1]);
    const r = await db.all<{ id: number }>(
      "SELECT rowid AS id FROM articles_fts WHERE articles_fts MATCH ?",
      ["second"],
    );
    expect(r).toEqual([{ id: 1 }]);
  });

  it("deleting an article removes from FTS via trigger", async () => {
    await db.run("INSERT INTO articles (id, url, title, content) VALUES (?, ?, ?, ?)", [
      1,
      "https://x",
      "Hello",
      "body",
    ]);
    await db.run("DELETE FROM articles WHERE id = 1");
    const r = await db.all<{ id: number }>(
      "SELECT rowid AS id FROM articles_fts WHERE articles_fts MATCH ?",
      ["body"],
    );
    expect(r).toEqual([]);
  });
});
