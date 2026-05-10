import type { DbDriver } from "../driver";

export type Filter = "unread" | "starred" | "archive" | "all" | "in-progress";

/**
 * Threshold band for "in progress": user scrolled past the opening (>5%)
 * but hasn't reached the end (<95%). Below 5% counts as "haven't started";
 * past 95% counts as "effectively read" and we don't want articles that
 * trickled to the end stuck in this view forever.
 */
const IN_PROGRESS_LOW = 0.05;
const IN_PROGRESS_HIGH = 0.95;

export type ArticleRow = {
  id: number;
  backend_id: string | null;
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
  "backend_id",
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

export async function findArticleByBackendId(
  db: DbDriver,
  backendId: string,
): Promise<ArticleRow | null> {
  return db.get<ArticleRow>(`SELECT ${COLS.join(", ")} FROM articles WHERE backend_id = ?`, [
    backendId,
  ]);
}

/** Slim row for the article list. Excludes the full HTML body; `excerpt`
 * is a small SUBSTR taken in SQL so we never ship raw bodies into JS for
 * articles the user only sees in the list. */
export type ArticleListRow = Pick<
  ArticleRow,
  | "id"
  | "title"
  | "url"
  | "domain_name"
  | "preview_picture"
  | "reading_time"
  | "is_archived"
  | "is_starred"
  | "updated_at"
  | "scroll_position"
> & { excerpt: string | null };

const LIST_COLS = [
  "id",
  "title",
  "url",
  "domain_name",
  "preview_picture",
  "reading_time",
  "is_archived",
  "is_starred",
  "updated_at",
  "scroll_position",
] as const;

const EXCERPT_LENGTH = 800;

function listSelect(alias: string): string {
  return [
    ...LIST_COLS.map((c) => `${alias}.${c}`),
    `SUBSTR(${alias}.content, 1, ${EXCERPT_LENGTH}) AS excerpt`,
  ].join(", ");
}

export async function listArticles(
  db: DbDriver,
  args: {
    filter: Filter;
    /** Tag slugs to AND-filter on top of the bucket filter. An article must
     * carry every slug in this list to appear in the result. Empty/omitted
     * means no tag filter. */
    tagSlugs?: readonly string[];
    limit?: number;
    offset?: number;
  },
): Promise<ArticleListRow[]> {
  const limit = args.limit ?? 200;
  const offset = args.offset ?? 0;
  const slugs = args.tagSlugs ?? [];
  const predicate = predicateForFilter(args.filter, "a");
  if (slugs.length === 0) {
    const where = predicate ? `WHERE ${predicate}` : "";
    return db.all<ArticleListRow>(
      `SELECT ${listSelect("a")}
         FROM articles a
         ${where}
         ORDER BY a.updated_at DESC LIMIT ? OFFSET ?`,
      [limit, offset],
    );
  }
  // AND-match: an article must have ALL the requested tags. We join through
  // article_tags + tags, group by article id, and require the distinct slug
  // count under the row to equal the requested set size. DISTINCT guards
  // against weird states where the same tag could attach twice.
  const placeholders = slugs.map(() => "?").join(", ");
  const baseClause = predicate ? `AND ${predicate}` : "";
  return db.all<ArticleListRow>(
    `SELECT ${listSelect("a")}
       FROM articles a
       JOIN article_tags at ON at.article_id = a.id
       JOIN tags t ON t.id = at.tag_id
       WHERE t.slug IN (${placeholders}) ${baseClause}
       GROUP BY a.id
       HAVING COUNT(DISTINCT t.slug) = ?
       ORDER BY a.updated_at DESC
       LIMIT ? OFFSET ?`,
    [...slugs, slugs.length, limit, offset],
  );
}

/**
 * Returns the SQL predicate (no leading WHERE) for a given bucket. Caller
 * decides whether to wrap it in a `WHERE …` or splice it into a join with
 * `AND …`. The optional table alias prefixes column references for use in
 * multi-table queries.
 */
function predicateForFilter(filter: Filter, alias?: string): string {
  const p = alias ? `${alias}.` : "";
  switch (filter) {
    case "unread":
      return `${p}is_archived = 0`;
    case "starred":
      return `${p}is_starred = 1`;
    case "archive":
      return `${p}is_archived = 1`;
    case "in-progress":
      return `${p}is_archived = 0 AND ${p}scroll_position > ${IN_PROGRESS_LOW} AND ${p}scroll_position < ${IN_PROGRESS_HIGH}`;
    case "all":
      return "";
  }
}

/**
 * Single round-trip count for every filter. Used by the rail to badge each
 * entry so the user can see at a glance how much sits in each bucket
 * without opening it. Computed in one query so it stays cheap as the
 * library grows.
 */
export type FilterCounts = Record<Filter, number>;

export async function countByFilter(db: DbDriver): Promise<FilterCounts> {
  // `all` is a SQL reserved word; aliased as `total` to keep this portable
  // across drivers. Coalesce to 0 because SUM returns NULL on an empty
  // table.
  const row = await db.get<{
    unread: number;
    starred: number;
    archive: number;
    in_progress: number;
    total: number;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN is_archived = 0 THEN 1 ELSE 0 END), 0) AS unread,
       COALESCE(SUM(CASE WHEN is_starred = 1 THEN 1 ELSE 0 END), 0) AS starred,
       COALESCE(SUM(CASE WHEN is_archived = 1 THEN 1 ELSE 0 END), 0) AS archive,
       COALESCE(SUM(CASE WHEN is_archived = 0
                AND scroll_position > ${IN_PROGRESS_LOW}
                AND scroll_position < ${IN_PROGRESS_HIGH} THEN 1 ELSE 0 END), 0) AS in_progress,
       COUNT(*) AS total
       FROM articles`,
  );
  return {
    unread: row?.unread ?? 0,
    starred: row?.starred ?? 0,
    archive: row?.archive ?? 0,
    "in-progress": row?.in_progress ?? 0,
    all: row?.total ?? 0,
  };
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

function toFtsQuery(input: string): string {
  const tokens = input
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t}"`);
  return tokens.join(" ");
}

async function ftsAvailable(db: DbDriver): Promise<boolean> {
  const row = await db.get<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name = 'articles_fts'",
  );
  return row !== null;
}

export async function searchArticles(db: DbDriver, query: string): Promise<ArticleListRow[]> {
  const q = query.trim();
  if (q.length === 0) return [];

  if (await ftsAvailable(db)) {
    const ftsQuery = toFtsQuery(q);
    if (ftsQuery.length === 0) return [];
    return db.all<ArticleListRow>(
      `SELECT ${listSelect("a")}
       FROM articles_fts f
       JOIN articles a ON a.id = f.rowid
       WHERE articles_fts MATCH ?
       ORDER BY a.updated_at DESC
       LIMIT 200`,
      [ftsQuery],
    );
  }

  // LIKE fallback for platforms without FTS5 (e.g. expo-sqlite web).
  // Tokenize the same way and require ALL tokens to appear somewhere in
  // title/content/url. Slower than FTS but correct.
  const tokens = q
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return [];
  const conditions = tokens
    .map(() => "(COALESCE(a.title, '') || ' ' || COALESCE(a.content, '') || ' ' || a.url) LIKE ?")
    .join(" AND ");
  const params = tokens.map((t) => `%${t}%`);
  return db.all<ArticleListRow>(
    `SELECT ${listSelect("a")}
     FROM articles a
     WHERE ${conditions}
     ORDER BY a.updated_at DESC
     LIMIT 200`,
    params,
  );
}

export async function articlesByTagSlug(db: DbDriver, slug: string): Promise<ArticleListRow[]> {
  return db.all<ArticleListRow>(
    `SELECT ${listSelect("a")}
     FROM articles a
     JOIN article_tags at ON at.article_id = a.id
     JOIN tags t ON t.id = at.tag_id
     WHERE t.slug = ?
     ORDER BY a.updated_at DESC
     LIMIT 200`,
    [slug],
  );
}
