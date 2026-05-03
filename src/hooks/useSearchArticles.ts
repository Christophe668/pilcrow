import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { searchArticles } from "@/db/repos/articles";
import { tagsForArticles } from "@/db/repos/tags";
import { getDb } from "@/db";
import { dataEvents } from "@/sync/events";
import type { ArticleListItem } from "@/hooks/useArticles";

async function runSearch(q: string): Promise<ArticleListItem[]> {
  const db = await getDb();
  const rows = await searchArticles(db, q);
  if (rows.length === 0) return [];
  const tagsByArticle = await tagsForArticles(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({ ...r, tags: tagsByArticle.get(r.id) ?? [] }));
}

export function useSearchArticles(query: string) {
  const qc = useQueryClient();
  useEffect(() => {
    return dataEvents.subscribe((e) => {
      if (e.kind === "articles") qc.invalidateQueries({ queryKey: ["search"] });
    });
  }, [qc]);
  return useQuery({
    queryKey: ["search", query],
    queryFn: () => runSearch(query),
    enabled: query.trim().length > 0,
    staleTime: 5_000,
  });
}
