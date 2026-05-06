import type { DbDriver } from "../driver";

export type Tag = { id: number; label: string; slug: string };

export async function upsertTags(db: DbDriver, tags: readonly Tag[]): Promise<void> {
  if (tags.length === 0) return;
  await db.transaction(async (tx) => {
    for (const t of tags) {
      await tx.run(
        `INSERT INTO tags (id, label, slug) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET label = excluded.label, slug = excluded.slug`,
        [t.id, t.label, t.slug],
      );
    }
  });
}

export async function listTags(db: DbDriver): Promise<Tag[]> {
  return db.all<Tag>("SELECT id, label, slug FROM tags ORDER BY slug");
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
