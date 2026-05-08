import { request } from "./client";
import type { BookmarkSyncEntry } from "./types";

type Auth = { serverUrl: string; accessToken: string };

/**
 * Reads the per-bookmark change log since the given RFC 3339 timestamp.
 * Unlike `/api/bookmarks`, this endpoint includes deletions
 * (`type: "delete"`) — that's the whole reason it exists. Pilcrow's
 * sync engine prefers this over the paginated bookmark list because
 * it gives correct delete semantics.
 *
 * Without `since`, Readeck returns only "currently exists" rows (no
 * delete log), so the caller should treat the absence of `since` as a
 * full bootstrap, not an incremental sync.
 */
export async function syncList(
  auth: Auth,
  args: { since?: string } = {},
): Promise<BookmarkSyncEntry[]> {
  return request<BookmarkSyncEntry[]>({
    ...auth,
    method: "GET",
    path: "/api/bookmarks/sync",
    query: { since: args.since },
  });
}
