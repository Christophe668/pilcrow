import { useEffect, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataEvents, type DataChangeEvent } from "@/sync/events";
import { getDb } from "@/db";
import { getSyncValue } from "@/db/repos/sync-state";

export type SyncStatus = {
  lastFullSyncAt: string | null;
  lastSince: string | null;
};

async function readStatus(): Promise<SyncStatus> {
  const db = await getDb();
  return {
    lastFullSyncAt: await getSyncValue(db, "last_full_sync_at"),
    lastSince: await getSyncValue(db, "last_since"),
  };
}

let version = 0;
const versionListeners = new Set<() => void>();

dataEvents.subscribe((e: DataChangeEvent) => {
  if (e.kind === "sync-status") {
    version += 1;
    for (const l of versionListeners) l();
  }
});

function useEventVersion(): number {
  return useSyncExternalStore(
    (cb) => {
      versionListeners.add(cb);
      return () => {
        versionListeners.delete(cb);
      };
    },
    () => version,
    () => version,
  );
}

export function useSyncStatus() {
  const v = useEventVersion();
  return useQuery({
    queryKey: ["sync-status", v],
    queryFn: readStatus,
    staleTime: 0,
  });
}

export function useDataChange(kind: DataChangeEvent["kind"], cb: () => void): void {
  useEffect(() => {
    return dataEvents.subscribe((e) => {
      if (e.kind === kind) cb();
    });
  }, [kind, cb]);
}
