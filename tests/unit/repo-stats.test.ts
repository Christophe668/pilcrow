import { describe, it, expect, beforeEach } from "vitest";
import { createBetterSqliteDriver } from "@/db/driver-better-sqlite3";
import { runMigrations } from "@/db/migrations";
import type { DbDriver } from "@/db/driver";
import { upsertArticles } from "@/db/repos/articles";
import { upsertTags, attachTags } from "@/db/repos/tags";
import { getTotals, monthlyActivity, topDomains, topLanguages, topTags } from "@/db/repos/stats";

let db: DbDriver;

beforeEach(async () => {
  db = await createBetterSqliteDriver(":memory:");
  await runMigrations(db);
});

const article = (
  over: Partial<{
    id: number;
    domain_name: string;
    language: string;
    reading_time: number;
    is_archived: number;
    is_starred: number;
    created_at: string;
    archived_at: string;
  }> = {},
) => ({
  id: 1,
  title: "t",
  url: "https://example.com/a",
  domain_name: "example.com",
  content: null,
  preview_picture: null,
  reading_time: 5,
  language: "en",
  is_archived: 0,
  is_starred: 0,
  created_at: "2026-05-01T00:00:00Z",
  updated_at: "2026-05-01T00:00:00Z",
  starred_at: null,
  archived_at: null,
  published_at: null,
  published_by: null,
  ...over,
});

describe("stats repo", () => {
  it("getTotals counts and sums correctly with empty annotations", async () => {
    await upsertArticles(db, [
      article({ id: 1, is_archived: 0, reading_time: 10 }),
      article({ id: 2, is_archived: 1, reading_time: 30, archived_at: "2026-05-02T00:00:00Z" }),
      article({
        id: 3,
        is_starred: 1,
        is_archived: 1,
        reading_time: 5,
        archived_at: "2026-05-03T00:00:00Z",
      }),
    ]);
    const t = await getTotals(db);
    expect(t.total).toBe(3);
    expect(t.unread).toBe(1);
    expect(t.archived).toBe(2);
    expect(t.starred).toBe(1);
    expect(t.minutesRead).toBe(35);
    expect(t.minutesPending).toBe(10);
    expect(t.annotations).toBe(0);
  });

  it("getTotals returns zeros on empty db", async () => {
    const t = await getTotals(db);
    expect(t).toEqual({
      total: 0,
      unread: 0,
      starred: 0,
      archived: 0,
      annotations: 0,
      minutesRead: 0,
      minutesPending: 0,
    });
  });

  it("topDomains aggregates and sorts by count desc", async () => {
    await upsertArticles(db, [
      article({ id: 1, domain_name: "a.com" }),
      article({ id: 2, domain_name: "a.com" }),
      article({ id: 3, domain_name: "b.com" }),
    ]);
    const d = await topDomains(db);
    expect(d).toEqual([
      { domain: "a.com", count: 2 },
      { domain: "b.com", count: 1 },
    ]);
  });

  it("topLanguages skips null/empty languages", async () => {
    await upsertArticles(db, [
      article({ id: 1, language: "en" }),
      article({ id: 2, language: "en" }),
      article({ id: 3, language: "fr" }),
      article({ id: 4, language: "" }),
    ]);
    const l = await topLanguages(db);
    expect(l).toEqual([
      { language: "en", count: 2 },
      { language: "fr", count: 1 },
    ]);
  });

  it("topTags joins through article_tags", async () => {
    await upsertArticles(db, [article({ id: 1 }), article({ id: 2 })]);
    await upsertTags(db, [
      { id: 10, label: "Tech", slug: "tech" },
      { id: 11, label: "News", slug: "news" },
    ]);
    await attachTags(db, 1, [10, 11]);
    await attachTags(db, 2, [10]);
    const t = await topTags(db);
    expect(t).toEqual([
      { label: "Tech", slug: "tech", count: 2 },
      { label: "News", slug: "news", count: 1 },
    ]);
  });

  it("monthlyActivity returns 12 buckets oldest→newest with correct counts", async () => {
    const now = new Date();
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-15T00:00:00Z`;
    const thisMonth = fmt(now);
    const lastMonth = fmt(new Date(now.getFullYear(), now.getMonth() - 1, 15));

    await upsertArticles(db, [
      article({ id: 1, created_at: thisMonth, is_archived: 0 }),
      article({ id: 2, created_at: thisMonth, is_archived: 1, archived_at: thisMonth }),
      article({ id: 3, created_at: lastMonth, is_archived: 0 }),
    ]);
    const months = await monthlyActivity(db);
    expect(months).toHaveLength(12);
    const last = months[months.length - 1];
    const prev = months[months.length - 2];
    expect(last?.saved).toBe(2);
    expect(last?.read).toBe(1);
    expect(prev?.saved).toBe(1);
    expect(prev?.read).toBe(0);
  });
});
