import { useMutation, useQueryClient } from "@tanstack/react-query";
import { runIncrementalSync } from "@/sync/engine";
import { backfillMissingContent } from "@/sync/content-backfill";
import { drainOutbox } from "@/sync/outbox-drainer";

export function useSyncNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await drainOutbox();
      await runIncrementalSync();
      // Not awaited: body/image backfill can take a while on a fresh
      // library, and the manual-sync spinner shouldn't hang on it.
      void backfillMissingContent().catch(() => {});
    },
    onSettled: () => {
      qc.invalidateQueries();
    },
  });
}
