import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { searchArticles } from "@/db/repos/articles";
import { tagsForArticle } from "@/db/repos/tags";
import { getDb } from "@/db";
import { dataEvents } from "@/sync/events";

async function runSearch(q: string) {
  const db = await getDb();
  const rows = await searchArticles(db, q);
  return Promise.all(rows.map(async (r) => ({ ...r, tags: await tagsForArticle(db, r.id) })));
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
