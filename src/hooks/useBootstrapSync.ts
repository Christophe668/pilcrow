import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useAuth } from "@/hooks/useAuth";
import { runInitialSync, runIncrementalSync } from "@/sync/engine";
import { drainOutbox } from "@/sync/outbox-drainer";
import { getDb } from "@/db";
import { getSyncValue } from "@/db/repos/sync-state";

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
        await runInitialSync().catch(() => {});
      } else {
        await drainOutbox().catch(() => {});
        await runIncrementalSync().catch(() => {});
      }
      if (!cancelled) initialDoneRef.current = true;
    })();

    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active" && initialDoneRef.current) {
        void drainOutbox()
          .catch(() => {})
          .then(() => runIncrementalSync().catch(() => {}));
      }
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [auth.status]);
}
