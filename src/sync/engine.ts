import { getDb } from "@/db";
import { getBackend } from "@/api/backend";
import { upsertArticles, type ArticleRow } from "@/db/repos/articles";
import { upsertTags, attachTags } from "@/db/repos/tags";
import { setSyncValue, getSyncValue } from "@/db/repos/sync-state";
import { dataEvents } from "./events";
import type { Article } from "@/api/backend";

const PER_PAGE = 100;

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

export async function runInitialSync(): Promise<void> {
  const db = await getDb();
  const backend = getBackend();

  const tags = await backend.listTags();
  await upsertTags(
    db,
    tags.map((t) => ({ id: Number(t.id), label: t.label, slug: t.slug })),
  );

  let page = 1;
  let totalPages = 1;
  let mostRecent: string | null = null;

  while (page <= totalPages) {
    const result = await backend.listArticles({
      page,
      perPage: PER_PAGE,
      detail: "metadata",
    });
    totalPages = result.totalPages;
    const rows = result.items.map(articleToRow);
    await upsertArticles(db, rows);

    for (const a of result.items) {
      if (a.tags.length > 0) {
        await attachTags(
          db,
          Number(a.id),
          a.tags.map((t) => Number(t.id)),
        );
      }
      if (!mostRecent || (a.updatedAt && a.updatedAt > mostRecent)) {
        mostRecent = a.updatedAt;
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

export async function runIncrementalSync(): Promise<void> {
  const db = await getDb();
  const backend = getBackend();
  const since = await getSyncValue(db, "last_since");
  const sinceNum = since ? Number(since) : undefined;

  const tags = await backend.listTags();
  await upsertTags(
    db,
    tags.map((t) => ({ id: Number(t.id), label: t.label, slug: t.slug })),
  );

  let page = 1;
  let totalPages = 1;
  let mostRecent: string | null = null;

  while (page <= totalPages) {
    const result = await backend.listArticles({
      page,
      perPage: PER_PAGE,
      detail: "full",
      ...(sinceNum !== undefined ? { since: sinceNum } : {}),
    });
    totalPages = result.totalPages;
    if (result.items.length === 0) break;

    const rows = result.items.map(articleToRow);
    await upsertArticles(db, rows);

    for (const a of result.items) {
      if (a.tags.length > 0) {
        await attachTags(
          db,
          Number(a.id),
          a.tags.map((t) => Number(t.id)),
        );
      }
      if (!mostRecent || (a.updatedAt && a.updatedAt > mostRecent)) {
        mostRecent = a.updatedAt;
      }
    }
    page += 1;
    if (totalPages === 0) break;
  }

  if (mostRecent) {
    await setSyncValue(db, "last_since", String(Math.floor(Date.parse(mostRecent) / 1000)));
  }

  dataEvents.emit({ kind: "articles" });
  dataEvents.emit({ kind: "tags" });
  dataEvents.emit({ kind: "sync-status" });
}
