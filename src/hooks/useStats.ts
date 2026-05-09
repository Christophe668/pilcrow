import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getDb } from "@/db";
import { getTotals, monthlyActivity, topDomains, topLanguages, topTags } from "@/db/repos/stats";
import { dataEvents } from "@/sync/events";

async function fetchStats() {
  const db = await getDb();
  const [totals, domains, tags, languages, months] = await Promise.all([
    getTotals(db),
    topDomains(db, 10),
    topTags(db, 10),
    topLanguages(db, 6),
    monthlyActivity(db),
  ]);
  return { totals, domains, tags, languages, months };
}

export type Stats = Awaited<ReturnType<typeof fetchStats>>;

export function useStats() {
  const qc = useQueryClient();
  useEffect(() => {
    return dataEvents.subscribe((e) => {
      if (e.kind === "articles" || e.kind === "tags" || e.kind === "annotations") {
        qc.invalidateQueries({ queryKey: ["stats"] });
      }
    });
  }, [qc]);
  return useQuery({
    queryKey: ["stats"],
    queryFn: fetchStats,
    staleTime: 30_000,
  });
}
