import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getDb } from "@/db";
import { getArticle, upsertArticles, type ArticleRow } from "@/db/repos/articles";
import { tagsForArticle, attachTags, upsertTags } from "@/db/repos/tags";
import { getBackend } from "@/api/backend";
import type { Article } from "@/api/backend";
import { dataEvents } from "@/sync/events";

function articleToRow(a: Article): Partial<ArticleRow> {
  return {
    id: Number(a.id),
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

async function fetchOne(id: number) {
  const db = await getDb();
  let row = await getArticle(db, id);

  if (row && row.content === null) {
    const article = await getBackend()
      .getArticle(String(id))
      .catch(() => null);
    if (article) {
      await upsertArticles(db, [articleToRow(article)]);
      if (article.tags.length > 0) {
        await upsertTags(
          db,
          article.tags.map((t) => ({ id: Number(t.id), label: t.label, slug: t.slug })),
        );
        await attachTags(
          db,
          Number(article.id),
          article.tags.map((t) => Number(t.id)),
        );
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
