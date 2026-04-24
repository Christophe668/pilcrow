import type { DbDriver } from "../driver";

export type Tag = { id: number; label: string; slug: string };

export type TagUpsert = Tag & { backend_id?: string };

export async function upsertTags(db: DbDriver, tags: readonly TagUpsert[]): Promise<void> {
  if (tags.length === 0) return;
  await db.transaction(async (tx) => {
    for (const t of tags) {
      const backendId = t.backend_id ?? String(t.id);
      await tx.run(
        `INSERT INTO tags (id, backend_id, label, slug) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           backend_id = excluded.backend_id,
           label = excluded.label,
           slug = excluded.slug`,
        [t.id, backendId, t.label, t.slug],
      );
    }
  });
}

export async function findTagByBackendId(db: DbDriver, backendId: string): Promise<Tag | null> {
  return db.get<Tag>("SELECT id, label, slug FROM tags WHERE backend_id = ?", [backendId]);
}

export type TagUpsertByBackendId = {
  backend_id: string;
  label: string;
  slug: string;
  /** Optional preferred local id; same contract as ArticleUpsert.id. */
  id?: number;
};

/**
 * Upserts a batch of tags keyed by `backend_id`. Returns a map from
 * each input's `backend_id` to the resulting local id, which the
 * sync engine uses to build the `article_tags` join rows.
 */
export async function upsertTagsByBackendId(
  db: DbDriver,
  tags: readonly TagUpsertByBackendId[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (tags.length === 0) return out;
  await db.transaction(async (tx) => {
    for (const t of tags) {
      const existing = await tx.get<{ id: number }>("SELECT id FROM tags WHERE backend_id = ?", [
        t.backend_id,
      ]);
      if (existing) {
        await tx.run("UPDATE tags SET label = ?, slug = ? WHERE id = ?", [
          t.label,
          t.slug,
          existing.id,
        ]);
        out.set(t.backend_id, existing.id);
        continue;
      }
      // INSERT path. Use the hint id only if it's free; otherwise fall
      // through to autoincrement so the operation can't fail because
      // the local sequence drifted from server ids. Pre-checking (vs.
      // try/catch on the INSERT) keeps the surrounding transaction
      // alive on web SQLite, where a constraint-aborting statement
      // can tear the txn down even when the JS caller catches.
      if (t.id !== undefined) {
        const collision = await tx.get<{ id: number }>("SELECT id FROM tags WHERE id = ?", [t.id]);
        if (!collision) {
          await tx.run("INSERT INTO tags (id, backend_id, label, slug) VALUES (?, ?, ?, ?)", [
            t.id,
            t.backend_id,
            t.label,
            t.slug,
          ]);
          out.set(t.backend_id, t.id);
          continue;
        }
      }
      const r = await tx.run("INSERT INTO tags (backend_id, label, slug) VALUES (?, ?, ?)", [
        t.backend_id,
        t.label,
        t.slug,
      ]);
      out.set(t.backend_id, Number(r.lastId));
    }
  });
  return out;
}

export async function listTags(db: DbDriver): Promise<Tag[]> {
  return db.all<Tag>("SELECT id, label, slug FROM tags ORDER BY slug");
}

export type TagWithCount = Tag & { count: number };

/**
 * Tags annotated with the number of non-deleted articles they're attached
 * to. Returned in descending count order so the rail surfaces the
 * most-used tags first; ties broken by slug for stable ordering.
 */
export async function listTagsWithCounts(db: DbDriver): Promise<TagWithCount[]> {
  return db.all<TagWithCount>(
    `SELECT t.id, t.label, t.slug, COUNT(at.article_id) AS count
       FROM tags t
       LEFT JOIN article_tags at ON at.tag_id = t.id
       LEFT JOIN articles a ON a.id = at.article_id
       WHERE a.id IS NOT NULL
       GROUP BY t.id, t.label, t.slug
       ORDER BY count DESC, t.slug ASC`,
  );
}

export async function attachTags(
  db: DbDriver,
  articleId: number,
  tagIds: readonly number[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.run("DELETE FROM article_tags WHERE article_id = ?", [articleId]);
    for (const tagId of tagIds) {
      await tx.run("INSERT INTO article_tags (article_id, tag_id) VALUES (?, ?)", [
        articleId,
        tagId,
      ]);
    }
  });
}

export async function tagsForArticle(db: DbDriver, articleId: number): Promise<Tag[]> {
  return db.all<Tag>(
    `SELECT t.id, t.label, t.slug
     FROM tags t
     JOIN article_tags at ON at.tag_id = t.id
     WHERE at.article_id = ?
     ORDER BY t.slug`,
    [articleId],
  );
}

/**
 * Batch lookup: returns a Map<articleId, Tag[]> for every requested
 * article id, in a single SQL round-trip. Used by the article list to
 * avoid the N+1 fetch pattern (was: 1 list query + N tag queries per
 * row, now: 2 queries total regardless of list size).
 *
 * Articles with no tags are present in the map with an empty array, so
 * the caller can dispense with `?? []` checks at call sites.
 */
export async function tagsForArticles(
  db: DbDriver,
  articleIds: readonly number[],
): Promise<Map<number, Tag[]>> {
  const result = new Map<number, Tag[]>();
  for (const id of articleIds) result.set(id, []);
  if (articleIds.length === 0) return result;
  const placeholders = articleIds.map(() => "?").join(", ");
  const rows = await db.all<Tag & { article_id: number }>(
    `SELECT at.article_id, t.id, t.label, t.slug
       FROM tags t
       JOIN article_tags at ON at.tag_id = t.id
       WHERE at.article_id IN (${placeholders})
       ORDER BY t.slug`,
    [...articleIds],
  );
  for (const r of rows) {
    const list = result.get(r.article_id);
    if (list) list.push({ id: r.id, label: r.label, slug: r.slug });
  }
  return result;
}
