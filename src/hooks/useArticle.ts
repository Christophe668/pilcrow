import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getArticle } from "@/db/repos/articles";
import { tagsForArticle } from "@/db/repos/tags";
import { getDb } from "@/db";
import { dataEvents } from "@/sync/events";

async function fetchOne(id: number) {
  const db = await getDb();
  const row = await getArticle(db, id);
  if (!row) return null;
  const tags = await tagsForArticle(db, id);
  return { ...row, tags };
}

export function useArticle(id: number) {
  const qc = useQueryClient();
  useEffect(() => {
    return dataEvents.subscribe((e) => {
      if (e.kind === "article" && e.id === id) {
        qc.invalidateQueries({ queryKey: ["article", id] });
      }
      if (e.kind === "articles") {
        qc.invalidateQueries({ queryKey: ["article", id] });
      }
    });
  }, [qc, id]);
  return useQuery({
    queryKey: ["article", id],
    queryFn: () => fetchOne(id),
    staleTime: 0,
  });
}
