import { getDb } from "@/db";
import { getBackend } from "@/api/backend";
import { upsertArticleByBackendId, type ArticleUpsert } from "@/db/repos/articles";
import { upsertTagsByBackendId, attachTags } from "@/db/repos/tags";
import { setSyncValue, getSyncValue } from "@/db/repos/sync-state";
import { dataEvents } from "./events";
import type { Article, Backend } from "@/api/backend";

const PER_PAGE = 100;

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

async function upsertTagsAndAttach(backend: Backend, articles: readonly Article[]): Promise<void> {
  const db = await getDb();
  // Collect every distinct tag from this batch and upsert them once;
  // remember the backend_id → local_id mapping so we can build the
  // per-article join rows below.
  const seen = new Map<string, { label: string; slug: string; preferredId?: number }>();
  for (const a of articles) {
    for (const t of a.tags) {
      if (seen.has(t.id)) continue;
      const entry: { label: string; slug: string; preferredId?: number } = {
        label: t.label,
        slug: t.slug,
      };
      if (backend.capabilities.localIdMatchesBackendId) {
        const n = Number(t.id);
        if (Number.isFinite(n) && Number.isInteger(n)) entry.preferredId = n;
      }
      seen.set(t.id, entry);
    }
  }
  if (seen.size === 0) return;

  const tagBackendIdToLocal = await upsertTagsByBackendId(
    db,
    [...seen.entries()].map(([backend_id, info]) => ({
      backend_id,
      label: info.label,
      slug: info.slug,
      ...(info.preferredId !== undefined ? { id: info.preferredId } : {}),
    })),
  );

  // Resolve the local article id for each article (it was just upserted),
  // then attach the resolved local tag ids.
  for (const a of articles) {
    if (a.tags.length === 0) continue;
    const localTagIds = a.tags
      .map((t) => tagBackendIdToLocal.get(t.id))
      .filter((x): x is number => x !== undefined);
    if (localTagIds.length === 0) continue;
    // The article was already upserted by the caller; look up its local id
    // by backend_id rather than tracking it through an out-param.
    const articleRow = await db.get<{ id: number }>(
      "SELECT id FROM articles WHERE backend_id = ?",
      [a.id],
    );
    if (articleRow) await attachTags(db, articleRow.id, localTagIds);
  }
}

async function syncTagsFromBackend(backend: Backend): Promise<void> {
  const db = await getDb();
  const tags = await backend.listTags();
  if (tags.length === 0) return;
  await upsertTagsByBackendId(
    db,
    tags.map((t) => {
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
}

export async function runInitialSync(): Promise<void> {
  const db = await getDb();
  const backend = getBackend();
  await syncTagsFromBackend(backend);

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
    for (const a of result.items) {
      await upsertArticleByBackendId(db, articleToUpsert(a, backend));
      if (!mostRecent || (a.updatedAt && a.updatedAt > mostRecent)) {
        mostRecent = a.updatedAt;
      }
    }
    await upsertTagsAndAttach(backend, result.items);

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
  await syncTagsFromBackend(backend);

  const since = await getSyncValue(db, "last_since");
  const sinceNum = since ? Number(since) : undefined;

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

    for (const a of result.items) {
      await upsertArticleByBackendId(db, articleToUpsert(a, backend));
      if (!mostRecent || (a.updatedAt && a.updatedAt > mostRecent)) {
        mostRecent = a.updatedAt;
      }
    }
    await upsertTagsAndAttach(backend, result.items);

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
