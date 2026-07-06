import type { DbDriver } from "../driver";

export type SyncStateKey =
  | "last_initial_page"
  | "last_since"
  | "last_full_sync_at"
  /** ISO timestamp of the last full-listing delete sweep (backends without a change log). */
  | "last_delete_sweep_at"
  /** RFC 3339 cursor into the backend change log (Readeck /api/bookmarks/sync). */
  | "changes_since";

export async function getSyncValue(db: DbDriver, key: SyncStateKey): Promise<string | null> {
  const row = await db.get<{ value: string }>("SELECT value FROM sync_state WHERE key = ?", [key]);
  return row?.value ?? null;
}

export async function setSyncValue(db: DbDriver, key: SyncStateKey, value: string): Promise<void> {
  await db.run(
    `INSERT INTO sync_state (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}
