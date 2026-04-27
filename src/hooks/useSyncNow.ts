import { useMutation, useQueryClient } from "@tanstack/react-query";
import { runIncrementalSync } from "@/sync/engine";
import { drainOutbox } from "@/sync/outbox-drainer";

export function useSyncNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await drainOutbox();
      await runIncrementalSync();
    },
    onSettled: () => {
      qc.invalidateQueries();
    },
  });
}
