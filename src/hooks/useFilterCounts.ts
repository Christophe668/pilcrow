import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { countByFilter, type FilterCounts } from "@/db/repos/articles";
import { getDb } from "@/db";
import { dataEvents } from "@/sync/events";

/**
 * Counts for each library filter (Unread / Starred / Archive / In progress
 * / All). Invalidated whenever articles change so the rail badges stay in
 * sync with archive / star / read-progress edits.
 */
export function useFilterCounts() {
  const qc = useQueryClient();
  useEffect(() => {
    return dataEvents.subscribe((e) => {
      if (e.kind === "articles") {
        qc.invalidateQueries({ queryKey: ["filter-counts"] });
      }
    });
  }, [qc]);
  return useQuery<FilterCounts>({
    queryKey: ["filter-counts"],
    queryFn: async () => countByFilter(await getDb()),
    staleTime: 30_000,
  });
}
