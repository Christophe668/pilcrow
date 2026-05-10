import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getDb } from "@/db";
import { getArticle, upsertArticleByBackendId, type ArticleUpsert } from "@/db/repos/articles";
import { tagsForArticle, attachTags, upsertTagsByBackendId } from "@/db/repos/tags";
import { getBackend } from "@/api/backend";
import type { Article, Backend } from "@/api/backend";
import { dataEvents } from "@/sync/events";

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

async function fetchOne(id: number) {
  const db = await getDb();
  let row = await getArticle(db, id);

  if (row && row.content === null && row.backend_id !== null) {
    const backend = getBackend();
    const article = await backend.getArticle(row.backend_id).catch(() => null);
    if (article) {
      await upsertArticleByBackendId(db, articleToUpsert(article, backend));
      if (article.tags.length > 0) {
        const tagMap = await upsertTagsByBackendId(
          db,
          article.tags.map((t) => {
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
        const localTagIds = article.tags
          .map((t) => tagMap.get(t.id))
          .filter((x): x is number => x !== undefined);
        if (localTagIds.length > 0) await attachTags(db, id, localTagIds);
      }
      row = await getArticle(db, id);
    }
  }

  if (!row) return null;
  const tags = await tagsForArticle(db, id);
  return { ...row, tags };
}

export function useFullArticle(id: number) {
  const qc = useQueryClient();
  useEffect(() => {
    return dataEvents.subscribe((e) => {
      if (e.kind === "article" && e.id === id) {
        qc.invalidateQueries({ queryKey: ["full-article", id] });
      }
    });
  }, [qc, id]);
  return useQuery({
    queryKey: ["full-article", id],
    queryFn: () => fetchOne(id),
    staleTime: 0,
  });
}
