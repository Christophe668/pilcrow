import { describe, it, expect, beforeEach } from "vitest";
import { createBetterSqliteDriver } from "@/db/driver-better-sqlite3";
import { runMigrations } from "@/db/migrations";
import { listArticles } from "@/db/repos/articles";
import type { DbDriver } from "@/db/driver";

let db: DbDriver;

async function insertArticle(opts: {
  id: number;
  archived?: boolean;
  starred?: boolean;
  scroll?: number;
  updatedAt?: string;
}) {
  await db.run(
    `INSERT INTO articles (id, url, is_archived, is_starred, scroll_position, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      opts.id,
      `https://x/${opts.id}`,
      opts.archived ? 1 : 0,
      opts.starred ? 1 : 0,
      opts.scroll ?? 0,
      opts.updatedAt ?? new Date().toISOString(),
    ],
  );
}

async function insertTag(id: number, slug: string) {
  await db.run(`INSERT INTO tags (id, label, slug) VALUES (?, ?, ?)`, [id, slug, slug]);
}

async function attach(articleId: number, tagId: number) {
  await db.run(`INSERT INTO article_tags (article_id, tag_id) VALUES (?, ?)`, [articleId, tagId]);
}

beforeEach(async () => {
  db = await createBetterSqliteDriver(":memory:");
  await runMigrations(db);
  // Tags
  await insertTag(1, "design");
  await insertTag(2, "rust");
  await insertTag(3, "typography");
  // Articles + their tags
  await insertArticle({ id: 1 }); // design
  await insertArticle({ id: 2 }); // design + rust
  await insertArticle({ id: 3 }); // rust
  await insertArticle({ id: 4, archived: true }); // design + typography (archived)
  await insertArticle({ id: 5 }); // (no tags)

  await attach(1, 1);
  await attach(2, 1);
  await attach(2, 2);
  await attach(3, 2);
  await attach(4, 1);
  await attach(4, 3);
});

describe("listArticles with tagSlugs", () => {
  it("returns articles matching ANY single tag", async () => {
    const r = await listArticles(db, { filter: "all", tagSlugs: ["design"] });
    expect(r.map((a) => a.id).sort()).toEqual([1, 2, 4]);
  });

  it("AND-matches multiple tags — every requested tag must be present", async () => {
    // Only article 2 carries both design and rust
    const r = await listArticles(db, { filter: "all", tagSlugs: ["design", "rust"] });
    expect(r.map((a) => a.id)).toEqual([2]);
  });

  it("layers correctly on top of bucket filters", async () => {
    // design tag + unread (i.e. not archived) → should EXCLUDE article 4
    const r = await listArticles(db, { filter: "unread", tagSlugs: ["design"] });
    expect(r.map((a) => a.id).sort()).toEqual([1, 2]);
  });

  it("returns nothing when an unknown tag is requested", async () => {
    const r = await listArticles(db, { filter: "all", tagSlugs: ["does-not-exist"] });
    expect(r).toEqual([]);
  });

  it("ignores empty tag list (behaves like no tag filter)", async () => {
    const r = await listArticles(db, { filter: "all", tagSlugs: [] });
    expect(r).toHaveLength(5);
  });

  it("respects in-progress + tag combination", async () => {
    // Set article 1 (design) to in-progress
    await db.run(`UPDATE articles SET scroll_position = 0.4 WHERE id = ?`, [1]);
    const r = await listArticles(db, { filter: "in-progress", tagSlugs: ["design"] });
    expect(r.map((a) => a.id)).toEqual([1]);
  });
});
