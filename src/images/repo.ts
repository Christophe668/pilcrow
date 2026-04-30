import type { DbDriver } from "@/db/driver";

export type ImageRow = {
  article_id: number;
  src: string;
  local_path: string | null;
  status: "pending" | "cached" | "failed";
  size_bytes: number | null;
  cached_at: string | null;
};

export async function rememberPending(db: DbDriver, articleId: number, src: string): Promise<void> {
  await db.run(
    `INSERT INTO images (article_id, src, status) VALUES (?, ?, 'pending')
     ON CONFLICT(article_id, src) DO NOTHING`,
    [articleId, src],
  );
}

export async function markCached(
  db: DbDriver,
  articleId: number,
  src: string,
  localPath: string,
  sizeBytes: number,
): Promise<void> {
  await db.run(
    `UPDATE images
     SET status = 'cached', local_path = ?, size_bytes = ?, cached_at = ?
     WHERE article_id = ? AND src = ?`,
    [localPath, sizeBytes, new Date().toISOString(), articleId, src],
  );
}

export async function markFailed(db: DbDriver, articleId: number, src: string): Promise<void> {
  await db.run(`UPDATE images SET status = 'failed' WHERE article_id = ? AND src = ?`, [
    articleId,
    src,
  ]);
}

export async function getImage(
  db: DbDriver,
  articleId: number,
  src: string,
): Promise<ImageRow | null> {
  return db.get<ImageRow>(
    `SELECT article_id, src, local_path, status, size_bytes, cached_at
     FROM images WHERE article_id = ? AND src = ?`,
    [articleId, src],
  );
}

export async function imagesForArticle(db: DbDriver, articleId: number): Promise<ImageRow[]> {
  return db.all<ImageRow>(
    `SELECT article_id, src, local_path, status, size_bytes, cached_at
     FROM images WHERE article_id = ?`,
    [articleId],
  );
}

export async function pickEvictionCandidates(
  db: DbDriver,
  budgetBytes: number,
): Promise<ImageRow[]> {
  const oldest = await db.all<ImageRow>(
    `SELECT article_id, src, local_path, status, size_bytes, cached_at
     FROM images
     WHERE status = 'cached'
     ORDER BY cached_at ASC`,
  );
  const candidates: ImageRow[] = [];
  let evicted = 0;
  for (const row of oldest) {
    if (evicted >= budgetBytes) break;
    candidates.push(row);
    evicted += row.size_bytes ?? 0;
  }
  return candidates;
}

export async function deleteImage(db: DbDriver, articleId: number, src: string): Promise<void> {
  await db.run("DELETE FROM images WHERE article_id = ? AND src = ?", [articleId, src]);
}
