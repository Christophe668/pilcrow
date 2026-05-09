import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { articlesByTagSlug } from "@/db/repos/articles";
import { tagsForArticles } from "@/db/repos/tags";
import { getDb } from "@/db";
import { dataEvents } from "@/sync/events";
import type { ArticleListItem } from "@/hooks/useArticles";

export function useArticlesByTag(slug: string) {
  const qc = useQueryClient();
  useEffect(() => {
    return dataEvents.subscribe((e) => {
      if (e.kind === "articles" || e.kind === "tags") {
        qc.invalidateQueries({ queryKey: ["articles-by-tag", slug] });
      }
    });
  }, [qc, slug]);
  return useQuery<ArticleListItem[]>({
    queryKey: ["articles-by-tag", slug],
    queryFn: async () => {
      const db = await getDb();
      const rows = await articlesByTagSlug(db, slug);
      if (rows.length === 0) return [];
      const tagsByArticle = await tagsForArticles(
        db,
        rows.map((r) => r.id),
      );
      return rows.map((r) => ({ ...r, tags: tagsByArticle.get(r.id) ?? [] }));
    },
    staleTime: 5_000,
  });
}
