import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listTagsWithCounts, type TagWithCount } from "@/db/repos/tags";
import { getDb } from "@/db";
import { dataEvents } from "@/sync/events";

/**
 * Tags with article counts. Used by the rail to surface most-used tags
 * first and to render counts alongside labels. Re-fetches when articles or
 * tags change so the counts stay in sync.
 */
export function useTagsWithCounts() {
  const qc = useQueryClient();
  useEffect(() => {
    return dataEvents.subscribe((e) => {
      if (e.kind === "articles" || e.kind === "tags") {
        qc.invalidateQueries({ queryKey: ["tags-with-counts"] });
      }
    });
  }, [qc]);
  return useQuery<TagWithCount[]>({
    queryKey: ["tags-with-counts"],
    queryFn: async () => listTagsWithCounts(await getDb()),
    staleTime: 30_000,
  });
}
