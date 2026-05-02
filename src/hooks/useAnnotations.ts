import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listAnnotations } from "@/db/repos/annotations";
import { getDb } from "@/db";
import { dataEvents } from "@/sync/events";

export function useAnnotations(articleId: number) {
  const qc = useQueryClient();
  useEffect(() => {
    return dataEvents.subscribe((e) => {
      if (e.kind === "annotations" && e.articleId === articleId) {
        qc.invalidateQueries({ queryKey: ["annotations", articleId] });
      }
    });
  }, [qc, articleId]);
  return useQuery({
    queryKey: ["annotations", articleId],
    queryFn: async () => listAnnotations(await getDb(), articleId),
    staleTime: 0,
  });
}
