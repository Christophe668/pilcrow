import { useMutation } from "@tanstack/react-query";
import { upsertArticles, type ArticleRow } from "@/db/repos/articles";
import { attachTags } from "@/db/repos/tags";
import { getDb } from "@/db";
import { dataEvents } from "@/sync/events";
import { getBackend } from "@/api/backend";
import type { Article } from "@/api/backend";

/**
 * Asks the backend to re-fetch the article's source URL and re-run
 * extraction. The server returns the refreshed article, which we write
 * straight into the local DB so the reader picks up the new content
 * without waiting for the next full sync.
 */
export async function reloadEntryAction(articleId: number): Promise<Article> {
  const fresh = await getBackend().reloadArticle(String(articleId));
  const db = await getDb();
  await upsertArticles(db, [articleToRow(fresh)]);
  if (fresh.tags.length > 0) {
    await attachTags(
      db,
      Number(fresh.id),
      fresh.tags.map((t) => Number(t.id)),
    );
  }
  // Tell every list and the article view to re-read from the DB.
  dataEvents.emit({ kind: "articles" });
  return fresh;
}

function articleToRow(a: Article): Partial<ArticleRow> {
  return {
    id: Number(a.id),
    backend_id: a.id,
    title: a.title,
    url: a.url,
    domain_name: a.domainName,
    content: a.content,
    preview_picture: a.previewPicture,
    reading_time: a.readingTime,
    language: a.language,
    is_archived: a.isArchived ? 1 : 0,
    is_starred: a.isStarred ? 1 : 0,
    created_at: a.createdAt,
    updated_at: a.updatedAt,
    starred_at: a.starredAt,
    archived_at: a.archivedAt,
    published_at: a.publishedAt,
    published_by: a.authors.length > 0 ? a.authors.join(", ") : null,
    server_updated_at: a.updatedAt,
  };
}

export function useReloadEntry() {
  return useMutation({
    mutationFn: (id: number) => reloadEntryAction(id),
  });
}
