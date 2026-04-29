import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listTags } from "@/db/repos/tags";
import { getDb } from "@/db";
import { dataEvents } from "@/sync/events";

export function useTags() {
  const qc = useQueryClient();
  useEffect(() => {
    return dataEvents.subscribe((e) => {
      if (e.kind === "tags") qc.invalidateQueries({ queryKey: ["tags"] });
    });
  }, [qc]);
  return useQuery({
    queryKey: ["tags"],
    queryFn: async () => listTags(await getDb()),
    staleTime: 30_000,
  });
}
