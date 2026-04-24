import type { DbDriver } from "../driver";

export type Totals = {
  total: number;
  unread: number;
  starred: number;
  archived: number;
  annotations: number;
  // reading_time is stored in minutes by Wallabag
  minutesRead: number;
  minutesPending: number;
};

export type DomainCount = { domain: string; count: number };
export type TagCount = { label: string; slug: string; count: number };
export type LanguageCount = { language: string; count: number };
export type MonthBucket = { month: string; saved: number; read: number };

export async function getTotals(db: DbDriver): Promise<Totals> {
  const row = await db.get<{
    total: number;
    unread: number;
    starred: number;
    archived: number;
    minutes_read: number | null;
    minutes_pending: number | null;
  }>(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN is_archived = 0 THEN 1 ELSE 0 END) AS unread,
       SUM(CASE WHEN is_starred = 1 THEN 1 ELSE 0 END) AS starred,
       SUM(CASE WHEN is_archived = 1 THEN 1 ELSE 0 END) AS archived,
       SUM(CASE WHEN is_archived = 1 THEN COALESCE(reading_time, 0) ELSE 0 END) AS minutes_read,
       SUM(CASE WHEN is_archived = 0 THEN COALESCE(reading_time, 0) ELSE 0 END) AS minutes_pending
     FROM articles`,
  );
  const ann = await db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM annotations`);
  return {
    total: row?.total ?? 0,
    unread: row?.unread ?? 0,
    starred: row?.starred ?? 0,
    archived: row?.archived ?? 0,
    annotations: ann?.c ?? 0,
    minutesRead: row?.minutes_read ?? 0,
    minutesPending: row?.minutes_pending ?? 0,
  };
}

export async function topDomains(db: DbDriver, limit = 10): Promise<DomainCount[]> {
  return db.all<DomainCount>(
    `SELECT domain_name AS domain, COUNT(*) AS count
     FROM articles
     WHERE domain_name IS NOT NULL AND domain_name <> ''
     GROUP BY domain_name
     ORDER BY count DESC, domain_name ASC
     LIMIT ?`,
    [limit],
  );
}

export async function topTags(db: DbDriver, limit = 10): Promise<TagCount[]> {
  return db.all<TagCount>(
    `SELECT t.label AS label, t.slug AS slug, COUNT(at.article_id) AS count
     FROM tags t
     JOIN article_tags at ON at.tag_id = t.id
     GROUP BY t.id
     ORDER BY count DESC, t.label ASC
     LIMIT ?`,
    [limit],
  );
}

export async function topLanguages(db: DbDriver, limit = 6): Promise<LanguageCount[]> {
  return db.all<LanguageCount>(
    `SELECT language, COUNT(*) AS count
     FROM articles
     WHERE language IS NOT NULL AND language <> ''
     GROUP BY language
     ORDER BY count DESC
     LIMIT ?`,
    [limit],
  );
}

// Last 12 months, oldest → newest. month is 'YYYY-MM'. SQLite stores
// timestamps as ISO strings, so substr(...,1,7) gives the month bucket.
export async function monthlyActivity(db: DbDriver): Promise<MonthBucket[]> {
  const saved = await db.all<{ month: string; c: number }>(
    `SELECT substr(created_at, 1, 7) AS month, COUNT(*) AS c
     FROM articles
     WHERE created_at IS NOT NULL
     GROUP BY month`,
  );
  const read = await db.all<{ month: string; c: number }>(
    `SELECT substr(archived_at, 1, 7) AS month, COUNT(*) AS c
     FROM articles
     WHERE is_archived = 1 AND archived_at IS NOT NULL
     GROUP BY month`,
  );
  const savedMap = new Map(saved.map((r) => [r.month, r.c]));
  const readMap = new Map(read.map((r) => [r.month, r.c]));

  const out: MonthBucket[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push({
      month: key,
      saved: savedMap.get(key) ?? 0,
      read: readMap.get(key) ?? 0,
    });
  }
  return out;
}
