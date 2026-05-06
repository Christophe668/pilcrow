import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getDb } from "@/db";
import { getArticle, upsertArticles } from "@/db/repos/articles";
import { tagsForArticle, attachTags, upsertTags } from "@/db/repos/tags";
import { getEntry } from "@/api/entries";
import { dataEvents } from "@/sync/events";

async function fetchOne(id: number) {
  const db = await getDb();
  let row = await getArticle(db, id);

  if (row && row.content === null) {
    const entry = await getEntry(id).catch(() => null);
    if (entry) {
      await upsertArticles(db, [
        {
          id: entry.id,
          title: entry.title,
          url: entry.url,
          domain_name: entry.domain_name,
          content: entry.content,
          preview_picture: entry.preview_picture,
          reading_time: entry.reading_time,
          language: entry.language,
          is_archived: entry.is_archived,
          is_starred: entry.is_starred,
          created_at: entry.created_at,
          updated_at: entry.updated_at,
          starred_at: entry.starred_at,
          archived_at: entry.archived_at,
          published_at: entry.published_at,
          published_by: entry.published_by ? entry.published_by.join(", ") : null,
          server_updated_at: entry.updated_at,
        },
      ]);
      if (entry.tags.length > 0) {
        await upsertTags(db, entry.tags);
        await attachTags(
          db,
          entry.id,
          entry.tags.map((t) => t.id),
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
