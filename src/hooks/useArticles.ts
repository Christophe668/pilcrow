import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listArticles, type Filter } from "@/db/repos/articles";
import { tagsForArticle } from "@/db/repos/tags";
import { getDb } from "@/db";
import { dataEvents } from "@/sync/events";

export type ArticleListItem = Awaited<ReturnType<typeof listArticles>>[number] & {
  tags: Awaited<ReturnType<typeof tagsForArticle>>;
};

async function fetchList(filter: Filter): Promise<ArticleListItem[]> {
  const db = await getDb();
  const rows = await listArticles(db, { filter });
  const enriched = await Promise.all(
    rows.map(async (r) => ({ ...r, tags: await tagsForArticle(db, r.id) })),
  );
  return enriched;
}

export function useArticles(filter: Filter) {
  const qc = useQueryClient();
  useEffect(() => {
    return dataEvents.subscribe((e) => {
      if (e.kind === "articles" || e.kind === "tags") {
        qc.invalidateQueries({ queryKey: ["articles"] });
      }
    });
  }, [qc]);
  return useQuery({
    queryKey: ["articles", { filter }],
    queryFn: () => fetchList(filter),
    staleTime: 5_000,
  });
}
