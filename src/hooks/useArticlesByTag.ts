import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { articlesByTagSlug } from "@/db/repos/articles";
import { tagsForArticle } from "@/db/repos/tags";
import { getDb } from "@/db";
import { dataEvents } from "@/sync/events";

export function useArticlesByTag(slug: string) {
  const qc = useQueryClient();
  useEffect(() => {
    return dataEvents.subscribe((e) => {
      if (e.kind === "articles" || e.kind === "tags") {
        qc.invalidateQueries({ queryKey: ["articles-by-tag", slug] });
      }
    });
  }, [qc, slug]);
  return useQuery({
    queryKey: ["articles-by-tag", slug],
    queryFn: async () => {
      const db = await getDb();
      const rows = await articlesByTagSlug(db, slug);
      return Promise.all(rows.map(async (r) => ({ ...r, tags: await tagsForArticle(db, r.id) })));
    },
    staleTime: 5_000,
  });
}
