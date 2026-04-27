import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useAuth } from "@/hooks/useAuth";
import { runInitialSync, runIncrementalSync } from "@/sync/engine";
import { drainOutbox } from "@/sync/outbox-drainer";
import { getDb } from "@/db";
import { getSyncValue } from "@/db/repos/sync-state";

// Surface sync failures in the dev console so a silent sync gap is
// debuggable. Production builds keep the existing swallow-and-continue
// behaviour so a transient failure doesn't surface as a console error.
function logSyncError(stage: string): (e: unknown) => void {
  return (e) => {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.error(`[sync] ${stage} failed`, e);
    }
  };
}

export function useBootstrapSync(): void {
  const auth = useAuth();
  const initialDoneRef = useRef(false);

  useEffect(() => {
    if (auth.status !== "authenticated") {
      initialDoneRef.current = false;
      return;
    }

    let cancelled = false;
    (async () => {
      const db = await getDb();
      const lastFull = await getSyncValue(db, "last_full_sync_at");
      if (!initialDoneRef.current && !lastFull) {
        await runInitialSync().catch(logSyncError("initial-sync"));
      } else {
        await drainOutbox().catch(logSyncError("outbox-drain"));
        await runIncrementalSync().catch(logSyncError("incremental-sync"));
      }
      if (!cancelled) initialDoneRef.current = true;
    })();

    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active" && initialDoneRef.current) {
        void drainOutbox()
          .catch(logSyncError("outbox-drain"))
          .then(() => runIncrementalSync().catch(logSyncError("incremental-sync")));
      }
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [auth.status]);
}
