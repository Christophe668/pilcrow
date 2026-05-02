import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listAllAnnotations } from "@/db/repos/annotations";
import { getDb } from "@/db";
import { dataEvents } from "@/sync/events";

export function useAllAnnotations(opts: { withNoteOnly?: boolean } = {}) {
  const { withNoteOnly = false } = opts;
  const qc = useQueryClient();
  const queryKey = ["all-annotations", { withNoteOnly }] as const;
  useEffect(() => {
    return dataEvents.subscribe((e) => {
      if (e.kind === "annotations" || e.kind === "articles") {
        qc.invalidateQueries({ queryKey: ["all-annotations"] });
      }
    });
  }, [qc]);
  return useQuery({
    queryKey,
    queryFn: async () => listAllAnnotations(await getDb(), { withNoteOnly }),
    staleTime: 0,
  });
}
