import { useMutation } from "@tanstack/react-query";
import { getArticle, upsertArticleByBackendId, type ArticleUpsert } from "@/db/repos/articles";
import { attachTags, upsertTagsByBackendId } from "@/db/repos/tags";
import { getDb } from "@/db";
import { dataEvents } from "@/sync/events";
import { getBackend } from "@/api/backend";
import type { Article, Backend } from "@/api/backend";

function articleToUpsert(a: Article, backend: Backend): ArticleUpsert {
  const row: ArticleUpsert = {
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
  if (backend.capabilities.localIdMatchesBackendId) {
    const n = Number(a.id);
    if (Number.isFinite(n) && Number.isInteger(n)) row.id = n;
  }
  return row;
}

/**
 * Asks the backend to re-fetch the article's source URL and re-run
 * extraction. The server returns the refreshed article, which we write
 * straight into the local DB so the reader picks up the new content
 * without waiting for the next full sync.
 */
export async function reloadEntryAction(articleId: number): Promise<Article> {
  const db = await getDb();
  const row = await getArticle(db, articleId);
  if (!row || row.backend_id === null) {
    throw new Error(`Cannot reload article ${articleId}: missing backend_id`);
  }
  const backend = getBackend();
  const fresh = await backend.reloadArticle(row.backend_id);
  const localId = await upsertArticleByBackendId(db, articleToUpsert(fresh, backend));
  if (fresh.tags.length > 0) {
    const tagMap = await upsertTagsByBackendId(
      db,
      fresh.tags.map((t) => {
        const entry: { backend_id: string; label: string; slug: string; id?: number } = {
          backend_id: t.id,
          label: t.label,
          slug: t.slug,
        };
        if (backend.capabilities.localIdMatchesBackendId) {
          const n = Number(t.id);
          if (Number.isFinite(n) && Number.isInteger(n)) entry.id = n;
        }
        return entry;
      }),
    );
    const localTagIds = fresh.tags
      .map((t) => tagMap.get(t.id))
      .filter((x): x is number => x !== undefined);
    if (localTagIds.length > 0) await attachTags(db, localId, localTagIds);
  }
  dataEvents.emit({ kind: "articles" });
  return fresh;
}

export function useReloadEntry() {
  return useMutation({
    mutationFn: (id: number) => reloadEntryAction(id),
  });
}
