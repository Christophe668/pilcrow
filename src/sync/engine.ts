import { getDb } from "@/db";
import { listEntries } from "@/api/entries";
import { listTags as apiListTags } from "@/api/tags";
import { upsertArticles, type ArticleRow } from "@/db/repos/articles";
import { upsertTags, attachTags } from "@/db/repos/tags";
import { setSyncValue } from "@/db/repos/sync-state";
import { dataEvents } from "./events";
import type { Entry } from "@/api/types";

const PER_PAGE = 100;

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

export async function runInitialSync(): Promise<void> {
  const db = await getDb();

  const tags = await apiListTags();
  await upsertTags(db, tags);

  let page = 1;
  let totalPages = 1;
  let mostRecent: string | null = null;

  while (page <= totalPages) {
    const result = await listEntries({ page, perPage: PER_PAGE, detail: "metadata" });
    totalPages = result.pages;
    const rows = result._embedded.items.map(entryToRow);
    await upsertArticles(db, rows);

    for (const e of result._embedded.items) {
      if (e.tags.length > 0) {
        await attachTags(
          db,
          e.id,
          e.tags.map((t) => t.id),
        );
      }
      if (!mostRecent || (e.updated_at && e.updated_at > mostRecent)) {
        mostRecent = e.updated_at;
      }
    }

    page += 1;
    if (totalPages === 0) break;
  }

  if (mostRecent) {
    await setSyncValue(db, "last_since", String(Math.floor(Date.parse(mostRecent) / 1000)));
  }
  await setSyncValue(db, "last_full_sync_at", new Date().toISOString());

  dataEvents.emit({ kind: "articles" });
  dataEvents.emit({ kind: "tags" });
  dataEvents.emit({ kind: "sync-status" });
}
