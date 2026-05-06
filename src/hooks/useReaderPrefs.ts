import { useEffect, useSyncExternalStore } from "react";
import { loadReaderPrefs, saveReaderPrefs, DEFAULT_PREFS, type ReaderPrefs } from "@/reader/prefs";

let cached: ReaderPrefs = DEFAULT_PREFS;
let loaded = false;
const listeners = new Set<() => void>();

async function load() {
  cached = await loadReaderPrefs();
  loaded = true;
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (!loaded) void load();
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): ReaderPrefs {
  return cached;
}

export function useReaderPrefs(): {
  prefs: ReaderPrefs;
  setPrefs: (next: Partial<ReaderPrefs>) => Promise<void>;
} {
  const prefs = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!loaded) void load();
  }, []);

  return {
    prefs,
    setPrefs: async (patch) => {
      const next = { ...cached, ...patch };
      cached = next;
      for (const l of listeners) l();
      await saveReaderPrefs(next);
    },
  };
}
