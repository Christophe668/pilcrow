import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listArticles, type ArticleListRow, type Filter } from "@/db/repos/articles";
import { tagsForArticles, type Tag } from "@/db/repos/tags";
import { getDb } from "@/db";
import { dataEvents } from "@/sync/events";

export type ArticleListItem = ArticleListRow & { tags: Tag[] };

async function fetchList(filter: Filter, tagSlugs: readonly string[]): Promise<ArticleListItem[]> {
  const db = await getDb();
  const rows = await listArticles(db, { filter, tagSlugs });
  if (rows.length === 0) return [];
  // Single batch tag fetch instead of N+1: one query for the whole page.
  const tagsByArticle = await tagsForArticles(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({ ...r, tags: tagsByArticle.get(r.id) ?? [] }));
}

/**
 * Lists articles for a bucket filter, optionally narrowed to articles
 * carrying every tag in `tagSlugs` (AND semantics). Tags layer on top of
 * the base filter — e.g. "Unread" + ["design"] returns unread articles
 * that are tagged design.
 *
 * Performance notes:
 *  - The list SELECT does NOT include the full HTML `content` column —
 *    only an 800-char SUBSTR `excerpt`. Saves shipping ~10–40 MB of HTML
 *    into JS memory for moderately-sized libraries.
 *  - Tag fetching is batched into a single query, not N+1 per row.
 */
export function useArticles(filter: Filter, tagSlugs: readonly string[] = []) {
  const qc = useQueryClient();
  useEffect(() => {
    return dataEvents.subscribe((e) => {
      if (e.kind === "articles" || e.kind === "tags") {
        qc.invalidateQueries({ queryKey: ["articles"] });
      }
    });
  }, [qc]);
  const slugKey = [...tagSlugs].sort().join(",");
  return useQuery({
    queryKey: ["articles", { filter, slugKey }],
    queryFn: () => fetchList(filter, tagSlugs),
    staleTime: 5_000,
  });
}
