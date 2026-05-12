import { describe, it, expect, beforeEach } from "vitest";
import { createBetterSqliteDriver } from "@/db/driver-better-sqlite3";
import { runMigrations } from "@/db/migrations";
import type { DbDriver } from "@/db/driver";
import {
  upsertArticles,
  getArticle,
  listArticles,
  setArchived,
  setStarred,
  setScrollPosition,
} from "@/db/repos/articles";

let db: DbDriver;

beforeEach(async () => {
  db = await createBetterSqliteDriver(":memory:");
  await runMigrations(db);
});

const sample = (
  over: Partial<{
    id: number;
    title: string;
    is_starred: number;
    is_archived: number;
    updated_at: string;
  }> = {},
) => ({
  id: 1,
  title: "Hello",
  url: "https://example.com/a",
  domain_name: "example.com",
  content: "<p>hi</p>",
  preview_picture: null,
  reading_time: 2,
  language: "en",
  is_archived: 0,
  is_starred: 0,
  created_at: "2026-05-01T00:00:00Z",
  updated_at: "2026-05-02T00:00:00Z",
  starred_at: null,
  archived_at: null,
  published_at: "2026-04-30T00:00:00Z",
  published_by: "alice",
  ...over,
});

describe("articles repo", () => {
  it("upsert + getArticle round-trips", async () => {
    await upsertArticles(db, [sample()]);
    const a = await getArticle(db, 1);
    expect(a?.title).toBe("Hello");
    expect(a?.is_archived).toBe(0);
  });

  it("upsert is idempotent and updates fields", async () => {
    await upsertArticles(db, [sample({ title: "Old" })]);
    await upsertArticles(db, [sample({ title: "New" })]);
    const a = await getArticle(db, 1);
    expect(a?.title).toBe("New");
  });

  it("listArticles filters by unread / starred / archive / all", async () => {
    await upsertArticles(db, [
      sample({ id: 1, is_archived: 0, is_starred: 0, updated_at: "2026-05-04T00:00:00Z" }),
      sample({ id: 2, is_archived: 1, is_starred: 0, updated_at: "2026-05-03T00:00:00Z" }),
      sample({ id: 3, is_archived: 0, is_starred: 1, updated_at: "2026-05-02T00:00:00Z" }),
    ]);
    expect((await listArticles(db, { filter: "unread" })).map((a) => a.id)).toEqual([1, 3]);
    expect((await listArticles(db, { filter: "archive" })).map((a) => a.id)).toEqual([2]);
    expect((await listArticles(db, { filter: "starred" })).map((a) => a.id)).toEqual([3]);
    expect((await listArticles(db, { filter: "all" })).map((a) => a.id)).toEqual([1, 2, 3]);
  });

  it("setArchived / setStarred toggle and bump local_updated_at + pending_op", async () => {
    await upsertArticles(db, [sample()]);
    await setArchived(db, 1, true);
    const a = await getArticle(db, 1);
    expect(a?.is_archived).toBe(1);
    expect(a?.pending_op).toBe("update");
    expect(a?.archived_at).toBeTruthy();
    expect(a?.local_updated_at).toBeTruthy();

    await setStarred(db, 1, true);
    const b = await getArticle(db, 1);
    expect(b?.is_starred).toBe(1);
    expect(b?.starred_at).toBeTruthy();
  });

  it("setScrollPosition stores 0..1", async () => {
    await upsertArticles(db, [sample()]);
    await setScrollPosition(db, 1, 0.42);
    const a = await getArticle(db, 1);
    expect(a?.scroll_position).toBeCloseTo(0.42, 4);
  });
});
