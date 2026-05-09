import { useMutation } from "@tanstack/react-query";
import { reloadEntry } from "@/api/entries";
import { upsertArticles, type ArticleRow } from "@/db/repos/articles";
import { attachTags } from "@/db/repos/tags";
import { getDb } from "@/db";
import { dataEvents } from "@/sync/events";
import type { Entry } from "@/api/types";

/**
 * Asks Wallabag to re-fetch the article's source URL and re-run
 * extraction. The server returns the refreshed entry, which we write
 * straight into the local DB so the reader picks up the new content
 * without waiting for the next full sync.
 */
export async function reloadEntryAction(articleId: number): Promise<Entry> {
  const fresh = await reloadEntry(articleId);
  const db = await getDb();
  await upsertArticles(db, [entryToRow(fresh)]);
  if (fresh.tags.length > 0) {
    await attachTags(
      db,
      fresh.id,
      fresh.tags.map((t) => t.id),
    );
  }
  // Tell every list and the article view to re-read from the DB.
  dataEvents.emit({ kind: "articles" });
  return fresh;
}

function entryToRow(e: Entry): Partial<ArticleRow> {
  return {
    id: e.id,
    title: e.title,
    url: e.url,
    domain_name: e.domain_name,
    content: e.content,
    preview_picture: e.preview_picture,
    reading_time: e.reading_time,
    language: e.language,
    is_archived: e.is_archived,
    is_starred: e.is_starred,
    created_at: e.created_at,
    updated_at: e.updated_at,
    starred_at: e.starred_at,
    archived_at: e.archived_at,
    published_at: e.published_at,
    published_by: e.published_by ? e.published_by.join(", ") : null,
    server_updated_at: e.updated_at,
  };
}

export function useReloadEntry() {
  return useMutation({
    mutationFn: (id: number) => reloadEntryAction(id),
  });
}
