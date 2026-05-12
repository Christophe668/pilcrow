import { describe, it, expect, beforeEach } from "vitest";
import { createBetterSqliteDriver } from "@/db/driver-better-sqlite3";
import { runMigrations } from "@/db/migrations";
import { countByFilter } from "@/db/repos/articles";
import type { DbDriver } from "@/db/driver";

let db: DbDriver;

async function insertArticle(opts: {
  id: number;
  archived?: boolean;
  starred?: boolean;
  scroll?: number;
}) {
  await db.run(
    `INSERT INTO articles (id, url, is_archived, is_starred, scroll_position)
     VALUES (?, ?, ?, ?, ?)`,
    [
      opts.id,
      `https://x/${opts.id}`,
      opts.archived ? 1 : 0,
      opts.starred ? 1 : 0,
      opts.scroll ?? 0,
    ],
  );
}

beforeEach(async () => {
  db = await createBetterSqliteDriver(":memory:");
  await runMigrations(db);
});

describe("countByFilter", () => {
  it("returns all-zero counts for an empty library", async () => {
    expect(await countByFilter(db)).toEqual({
      unread: 0,
      "in-progress": 0,
      starred: 0,
      archive: 0,
      all: 0,
    });
  });

  it("counts each filter independently", async () => {
    // 1: plain unread
    // 2: unread + starred
    // 3: unread + in-progress (40% read)
    // 4: archived + starred
    // 5: archived
    await insertArticle({ id: 1 });
    await insertArticle({ id: 2, starred: true });
    await insertArticle({ id: 3, scroll: 0.4 });
    await insertArticle({ id: 4, archived: true, starred: true });
    await insertArticle({ id: 5, archived: true });

    expect(await countByFilter(db)).toEqual({
      unread: 3, // 1, 2, 3 (not archived)
      "in-progress": 1, // 3 only (>5%, <95%, not archived)
      starred: 2, // 2, 4 (regardless of archive state)
      archive: 2, // 4, 5
      all: 5,
    });
  });

  it("excludes near-zero and near-finished articles from in-progress", async () => {
    // 1: scrolled past start but only by a hair (3%) — not in-progress
    // 2: legitimately in progress (50%)
    // 3: effectively read (96%) — not in-progress
    await insertArticle({ id: 1, scroll: 0.03 });
    await insertArticle({ id: 2, scroll: 0.5 });
    await insertArticle({ id: 3, scroll: 0.96 });

    const counts = await countByFilter(db);
    expect(counts["in-progress"]).toBe(1);
  });

  it("excludes archived articles from in-progress regardless of scroll", async () => {
    await insertArticle({ id: 1, scroll: 0.5, archived: true });
    const counts = await countByFilter(db);
    expect(counts["in-progress"]).toBe(0);
    expect(counts.archive).toBe(1);
  });
});
