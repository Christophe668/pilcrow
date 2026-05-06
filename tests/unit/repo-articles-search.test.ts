import { describe, it, expect, beforeEach } from "vitest";
import { createBetterSqliteDriver } from "@/db/driver-better-sqlite3";
import { runMigrations } from "@/db/migrations";
import type { DbDriver } from "@/db/driver";
import { searchArticles, upsertArticles } from "@/db/repos/articles";

let db: DbDriver;

beforeEach(async () => {
  db = await createBetterSqliteDriver(":memory:");
  await runMigrations(db);
});

const sample = (over: {
  id: number;
  title?: string;
  content?: string;
  url?: string;
  updated_at?: string;
}) => ({
  id: over.id,
  title: over.title ?? null,
  url: over.url ?? `https://x/${over.id}`,
  domain_name: "x",
  content: over.content ?? null,
  preview_picture: null,
  reading_time: null,
  language: null,
  is_archived: 0,
  is_starred: 0,
  created_at: "2026-05-01T00:00:00Z",
  updated_at: over.updated_at ?? "2026-05-02T00:00:00Z",
  starred_at: null,
  archived_at: null,
  published_at: null,
  published_by: null,
});

describe("searchArticles", () => {
  it("returns empty array for empty query", async () => {
    expect(await searchArticles(db, "")).toEqual([]);
    expect(await searchArticles(db, "   ")).toEqual([]);
  });

  it("matches title", async () => {
    await upsertArticles(db, [
      sample({ id: 1, title: "Cats are great" }),
      sample({ id: 2, title: "Dogs love walking" }),
    ]);
    const r = await searchArticles(db, "cats");
    expect(r.map((a) => a.id)).toEqual([1]);
  });

  it("matches content", async () => {
    await upsertArticles(db, [
      sample({ id: 1, title: "Travel", content: "best parisian cafes" }),
      sample({ id: 2, title: "Tech", content: "rust compilers" }),
    ]);
    const r = await searchArticles(db, "parisian");
    expect(r.map((a) => a.id)).toEqual([1]);
  });

  it("matches url", async () => {
    await upsertArticles(db, [sample({ id: 1, title: "T", url: "https://nytimes.com/path" })]);
    const r = await searchArticles(db, "nytimes");
    expect(r.map((a) => a.id)).toEqual([1]);
  });

  it("orders by updated_at DESC", async () => {
    await upsertArticles(db, [
      sample({ id: 1, title: "match older", updated_at: "2026-05-01T00:00:00Z" }),
      sample({ id: 2, title: "match newer", updated_at: "2026-05-05T00:00:00Z" }),
    ]);
    const r = await searchArticles(db, "match");
    expect(r.map((a) => a.id)).toEqual([2, 1]);
  });

  it("ignores SQL-special characters in the query", async () => {
    await upsertArticles(db, [sample({ id: 1, title: "hello world" })]);
    expect(await searchArticles(db, "hello: world!")).toHaveLength(1);
  });
});
