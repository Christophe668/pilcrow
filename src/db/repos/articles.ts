import type { DbDriver } from "../driver";

export type Filter = "unread" | "starred" | "archive" | "all";

export type ArticleRow = {
  id: number;
  title: string | null;
  url: string;
  domain_name: string | null;
  content: string | null;
  preview_picture: string | null;
  reading_time: number | null;
  language: string | null;
  is_archived: number;
  is_starred: number;
  created_at: string | null;
  updated_at: string | null;
  starred_at: string | null;
  archived_at: string | null;
  published_at: string | null;
  published_by: string | null;
  scroll_position: number;
  server_updated_at: string | null;
  local_updated_at: string | null;
  pending_op: string | null;
};

const COLS = [
  "id",
  "title",
  "url",
  "domain_name",
  "content",
  "preview_picture",
  "reading_time",
  "language",
  "is_archived",
  "is_starred",
  "created_at",
  "updated_at",
  "starred_at",
  "archived_at",
  "published_at",
  "published_by",
  "scroll_position",
  "server_updated_at",
  "local_updated_at",
  "pending_op",
] as const;

export async function upsertArticles(
  db: DbDriver,
  articles: readonly Partial<ArticleRow>[],
): Promise<void> {
  if (articles.length === 0) return;
  await db.transaction(async (tx) => {
    for (const a of articles) {
      const cols = COLS.filter((c) => a[c] !== undefined);
      const placeholders = cols.map(() => "?").join(", ");
      const updateSet = cols
        .filter((c) => c !== "id")
        .map((c) => `${c} = excluded.${c}`)
        .join(", ");
      const sql = `INSERT INTO articles (${cols.join(", ")}) VALUES (${placeholders})
                   ON CONFLICT(id) DO UPDATE SET ${updateSet}`;
      await tx.run(
        sql,
        cols.map((c) => a[c] as unknown),
      );
    }
  });
}

export async function getArticle(db: DbDriver, id: number): Promise<ArticleRow | null> {
  return db.get<ArticleRow>(`SELECT ${COLS.join(", ")} FROM articles WHERE id = ?`, [id]);
}

export async function listArticles(
  db: DbDriver,
  args: { filter: Filter; limit?: number; offset?: number },
): Promise<ArticleRow[]> {
  const where =
    args.filter === "unread"
      ? "WHERE is_archived = 0"
      : args.filter === "starred"
        ? "WHERE is_starred = 1"
        : args.filter === "archive"
          ? "WHERE is_archived = 1"
          : "";
  const limit = args.limit ?? 200;
  const offset = args.offset ?? 0;
  return db.all<ArticleRow>(
    `SELECT ${COLS.join(", ")} FROM articles ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
    [limit, offset],
  );
}

export async function setArchived(db: DbDriver, id: number, archived: boolean): Promise<void> {
  const now = new Date().toISOString();
  await db.run(
    `UPDATE articles SET is_archived = ?, archived_at = ?, local_updated_at = ?, pending_op = 'update' WHERE id = ?`,
    [archived ? 1 : 0, archived ? now : null, now, id],
  );
}

export async function setStarred(db: DbDriver, id: number, starred: boolean): Promise<void> {
  const now = new Date().toISOString();
  await db.run(
    `UPDATE articles SET is_starred = ?, starred_at = ?, local_updated_at = ?, pending_op = 'update' WHERE id = ?`,
    [starred ? 1 : 0, starred ? now : null, now, id],
  );
}

export async function setScrollPosition(db: DbDriver, id: number, position: number): Promise<void> {
  await db.run(`UPDATE articles SET scroll_position = ? WHERE id = ?`, [position, id]);
}

export async function deleteArticle(db: DbDriver, id: number): Promise<void> {
  await db.run("DELETE FROM articles WHERE id = ?", [id]);
}

export async function clearPendingOp(db: DbDriver, id: number): Promise<void> {
  await db.run(
    "UPDATE articles SET pending_op = NULL, server_updated_at = local_updated_at WHERE id = ?",
    [id],
  );
}
