import { describe, it, expect, beforeEach } from "vitest";
import { createBetterSqliteDriver } from "@/db/driver-better-sqlite3";
import { runMigrations } from "@/db/migrations";
import type { DbDriver } from "@/db/driver";
import { upsertTags, listTags, attachTags, tagsForArticle } from "@/db/repos/tags";

let db: DbDriver;

beforeEach(async () => {
  db = await createBetterSqliteDriver(":memory:");
  await runMigrations(db);
  await db.run(`INSERT INTO articles (id, url) VALUES (?, ?)`, [1, "https://example.com/a"]);
});

describe("tags repo", () => {
  it("upserts tags and lists them sorted", async () => {
    await upsertTags(db, [
      { id: 10, label: "Foo", slug: "foo" },
      { id: 11, label: "Bar", slug: "bar" },
    ]);
    const all = await listTags(db);
    expect(all.map((t) => t.slug)).toEqual(["bar", "foo"]);
  });

  it("upsert is idempotent and updates label", async () => {
    await upsertTags(db, [{ id: 10, label: "Old", slug: "foo" }]);
    await upsertTags(db, [{ id: 10, label: "New", slug: "foo" }]);
    const all = await listTags(db);
    expect(all).toEqual([{ id: 10, label: "New", slug: "foo" }]);
  });

  it("attachTags links and tagsForArticle returns them", async () => {
    await upsertTags(db, [
      { id: 10, label: "Foo", slug: "foo" },
      { id: 11, label: "Bar", slug: "bar" },
    ]);
    await attachTags(db, 1, [10, 11]);
    const t = await tagsForArticle(db, 1);
    expect(t.map((x) => x.slug).sort()).toEqual(["bar", "foo"]);
  });

  it("attachTags replaces previous links", async () => {
    await upsertTags(db, [
      { id: 10, label: "Foo", slug: "foo" },
      { id: 11, label: "Bar", slug: "bar" },
    ]);
    await attachTags(db, 1, [10, 11]);
    await attachTags(db, 1, [10]);
    const t = await tagsForArticle(db, 1);
    expect(t.map((x) => x.slug)).toEqual(["foo"]);
  });
});
