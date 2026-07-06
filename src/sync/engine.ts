import { getDb } from "@/db";
import { getBackend } from "@/api/backend";
import { upsertArticleByBackendId, type ArticleUpsert } from "@/db/repos/articles";
import { upsertTagsByBackendId, attachTags } from "@/db/repos/tags";
import { setSyncValue, getSyncValue } from "@/db/repos/sync-state";
import { pullAnnotations } from "./annotations-pull";
import { dataEvents } from "./events";
import type { Article, Backend } from "@/api/backend";
import type { DbDriver } from "@/db/driver";

const PER_PAGE = 100;

/**
 * Backends without a server change log (Wallabag) can only reveal
 * deletions by re-listing everything, so that sweep runs at most this
 * often rather than on every incremental sync.
 */
const DELETE_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

function articleToUpsert(a: Article, backend: Backend): ArticleUpsert {
  const row: ArticleUpsert = {
    backend_id: a.id,
    title: a.title,
    url: a.url,
    domain_name: a.domainName,
    // Never write a null body over a row that may already hold one. List
    // endpoints legitimately return no content (metadata-detail pages,
    // and Readeck lists always omit it) — treating that null as truth
    // would wipe content we already downloaded and break offline reading.
    ...(a.content !== null ? { content: a.content } : {}),
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
  // then attach the resolved local tag ids. An empty tag list still goes
  // through attachTags — that's how a server-side "remove last tag"
  // propagates (attachTags is delete-then-insert).
  for (const a of articles) {
    const localTagIds = a.tags
      .map((t) => tagBackendIdToLocal.get(t.id))
      .filter((x): x is number => x !== undefined);
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
  await pruneTagsMissingFrom(db, new Set(tags.map((t) => t.id)));
}

/**
 * Deletes local tags the server no longer reports. `listTags` is a
 * complete listing on both backends, so anything absent was deleted
 * server-side — except tags a pending `removeTag` outbox op still
 * references (the drainer needs their backend_id to build the request).
 */
async function pruneTagsMissingFrom(db: DbDriver, serverIds: ReadonlySet<string>): Promise<void> {
  const local = await db.all<{ id: number; backend_id: string }>(
    "SELECT id, backend_id FROM tags WHERE backend_id IS NOT NULL",
  );
  if (local.length === 0) return;
  const protectedIds = new Set<number>();
  for (const row of await db.all<{ payload_json: string }>(
    "SELECT payload_json FROM outbox WHERE op = 'removeTag'",
  )) {
    const tagId = (JSON.parse(row.payload_json) as { tagId?: unknown }).tagId;
    if (typeof tagId === "number") protectedIds.add(tagId);
  }
  const doomed = local.filter((t) => !serverIds.has(t.backend_id) && !protectedIds.has(t.id));
  if (doomed.length === 0) return;
  await db.transaction(async (tx) => {
    for (const t of doomed) {
      // Clear join rows explicitly rather than relying on the FK cascade:
      // expo-sqlite doesn't guarantee foreign_keys=ON on every platform.
      await tx.run("DELETE FROM article_tags WHERE tag_id = ?", [t.id]);
      await tx.run("DELETE FROM tags WHERE id = ?", [t.id]);
    }
  });
}

/**
 * Local article ids that a queued outbox op still refers to. Deleting
 * one of these rows would strand the op (its backend_id lookup fails
 * forever), so delete propagation skips them; if the article really is
 * gone server-side, a later sweep removes it once the outbox drains.
 */
async function outboxReferencedArticleIds(db: DbDriver): Promise<Set<number>> {
  const rows = await db.all<{ op: string; payload_json: string }>(
    "SELECT op, payload_json FROM outbox",
  );
  const ids = new Set<number>();
  const annotationIds: number[] = [];
  for (const r of rows) {
    const p = JSON.parse(r.payload_json) as Record<string, unknown>;
    const take = (v: unknown) => {
      if (typeof v === "number") ids.add(v);
    };
    switch (r.op) {
      case "createEntry":
        take(p.tempId);
        break;
      case "updateEntry":
      case "deleteEntry":
        take(p.id);
        break;
      case "addTag":
      case "removeTag":
      case "createAnnotation":
        take(p.entryId);
        break;
      case "updateAnnotation":
      case "deleteAnnotation":
        if (typeof p.id === "number") annotationIds.push(p.id);
        break;
    }
  }
  if (annotationIds.length > 0) {
    const placeholders = annotationIds.map(() => "?").join(", ");
    const parents = await db.all<{ article_id: number }>(
      `SELECT article_id FROM annotations WHERE id IN (${placeholders})`,
      annotationIds,
    );
    for (const row of parents) ids.add(row.article_id);
  }
  return ids;
}

async function deleteArticleRows(db: DbDriver, ids: readonly number[]): Promise<void> {
  if (ids.length === 0) return;
  await db.transaction(async (tx) => {
    for (const id of ids) {
      // Explicit child cleanup for the same reason as tag pruning: FK
      // cascades aren't guaranteed on every SQLite build we ship to.
      await tx.run("DELETE FROM article_tags WHERE article_id = ?", [id]);
      await tx.run("DELETE FROM annotations WHERE article_id = ?", [id]);
      await tx.run("DELETE FROM images WHERE article_id = ?", [id]);
      await tx.run("DELETE FROM articles WHERE id = ?", [id]);
    }
  });
}

function deletableRows(
  rows: readonly { id: number; pending_op: string | null }[],
  protectedIds: ReadonlySet<number>,
): number[] {
  return rows.filter((r) => r.pending_op === null && !protectedIds.has(r.id)).map((r) => r.id);
}

/**
 * Deletes every local article whose backend_id is absent from
 * `serverIds` (a complete listing of what exists server-side). Rows
 * with a pending op, an outbox reference, or no backend_id yet
 * (created locally, not pushed) are kept.
 */
async function pruneArticlesMissingFrom(
  db: DbDriver,
  serverIds: ReadonlySet<string>,
): Promise<void> {
  const local = await db.all<{ id: number; backend_id: string; pending_op: string | null }>(
    "SELECT id, backend_id, pending_op FROM articles WHERE backend_id IS NOT NULL",
  );
  const missing = local.filter((r) => !serverIds.has(r.backend_id));
  if (missing.length === 0) return;
  await deleteArticleRows(db, deletableRows(missing, await outboxReferencedArticleIds(db)));
}

/** Deletes the given backend ids, with the same guards as a sweep. */
async function deleteArticlesByBackendIds(
  db: DbDriver,
  backendIds: readonly string[],
): Promise<void> {
  if (backendIds.length === 0) return;
  const placeholders = backendIds.map(() => "?").join(", ");
  const rows = await db.all<{ id: number; pending_op: string | null }>(
    `SELECT id, pending_op FROM articles WHERE backend_id IN (${placeholders})`,
    backendIds,
  );
  if (rows.length === 0) return;
  await deleteArticleRows(db, deletableRows(rows, await outboxReferencedArticleIds(db)));
}

/** Pages through a complete metadata listing and returns every backend id. */
async function fetchAllArticleBackendIds(backend: Backend): Promise<Set<string>> {
  const ids = new Set<string>();
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages) {
    const result = await backend.listArticles({ page, perPage: PER_PAGE, detail: "metadata" });
    totalPages = result.totalPages;
    for (const a of result.items) ids.add(a.id);
    page += 1;
    if (totalPages === 0) break;
  }
  return ids;
}

/**
 * Removes local articles that were deleted on the server. Two
 * strategies, picked by backend capability:
 *
 * - Change log (Readeck): read `/api/bookmarks/sync` from the stored
 *   cursor and apply its `delete` entries. On the first run there is
 *   no cursor; the log then contains only currently-existing ids, so
 *   diff it against local rows instead.
 * - Full sweep (Wallabag): re-list every article's metadata and delete
 *   local rows that no longer appear, at most once per
 *   DELETE_SWEEP_INTERVAL_MS.
 */
async function propagateServerDeletes(db: DbDriver, backend: Backend): Promise<void> {
  if (backend.listChanges) {
    const since = await getSyncValue(db, "changes_since");
    const entries = await backend.listChanges(since ? { since } : {});
    if (since) {
      await deleteArticlesByBackendIds(
        db,
        entries.filter((e) => e.type === "delete").map((e) => e.id),
      );
    } else {
      await pruneArticlesMissingFrom(
        db,
        new Set(entries.filter((e) => e.type !== "delete").map((e) => e.id)),
      );
    }
    let cursor = since ?? null;
    for (const e of entries) {
      if (!cursor || Date.parse(e.time) > Date.parse(cursor)) cursor = e.time;
    }
    if (cursor) await setSyncValue(db, "changes_since", cursor);
    return;
  }

  const last = await getSyncValue(db, "last_delete_sweep_at");
  if (last && Date.now() - Date.parse(last) < DELETE_SWEEP_INTERVAL_MS) return;
  await pruneArticlesMissingFrom(db, await fetchAllArticleBackendIds(backend));
  await setSyncValue(db, "last_delete_sweep_at", new Date().toISOString());
}

// Single-flight guards: pull-to-refresh and the AppState-resume handler
// can fire at the same time; two interleaved syncs would race on
// last_since and double-apply work. Joining the in-flight run is always
// the right behaviour for a "sync now" caller.
let initialInFlight: Promise<void> | null = null;
let incrementalInFlight: Promise<void> | null = null;

export function runInitialSync(): Promise<void> {
  if (!initialInFlight) {
    initialInFlight = doRunInitialSync().finally(() => {
      initialInFlight = null;
    });
  }
  return initialInFlight;
}

export function runIncrementalSync(): Promise<void> {
  if (!incrementalInFlight) {
    incrementalInFlight = doRunIncrementalSync().finally(() => {
      incrementalInFlight = null;
    });
  }
  return incrementalInFlight;
}

async function doRunInitialSync(): Promise<void> {
  const db = await getDb();
  const backend = getBackend();
  await syncTagsFromBackend(backend);

  let page = 1;
  let totalPages = 1;
  let mostRecent: string | null = null;
  const seenBackendIds = new Set<string>();

  while (page <= totalPages) {
    const result = await backend.listArticles({
      page,
      perPage: PER_PAGE,
      detail: "metadata",
    });
    totalPages = result.totalPages;
    for (const a of result.items) {
      seenBackendIds.add(a.id);
      await upsertArticleByBackendId(db, articleToUpsert(a, backend));
      if (!mostRecent || (a.updatedAt && a.updatedAt > mostRecent)) {
        mostRecent = a.updatedAt;
      }
    }
    await upsertTagsAndAttach(backend, result.items);

    page += 1;
    if (totalPages === 0) break;
  }

  // The loop above listed everything the server has, so it doubles as a
  // delete sweep: anything local it didn't touch is gone server-side.
  await pruneArticlesMissingFrom(db, seenBackendIds);
  await setSyncValue(db, "last_delete_sweep_at", new Date().toISOString());

  await pullAnnotations(db, backend);

  if (mostRecent) {
    // Guard against unparseable server timestamps: persisting "NaN" would
    // poison every future sync's since parameter.
    const sinceEpoch = Math.floor(Date.parse(mostRecent) / 1000);
    if (Number.isFinite(sinceEpoch)) {
      await setSyncValue(db, "last_since", String(sinceEpoch));
    }
  }
  await setSyncValue(db, "last_full_sync_at", new Date().toISOString());

  dataEvents.emit({ kind: "articles" });
  dataEvents.emit({ kind: "tags" });
  dataEvents.emit({ kind: "sync-status" });
}

async function doRunIncrementalSync(): Promise<void> {
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

  await propagateServerDeletes(db, backend);
  await pullAnnotations(db, backend);

  if (mostRecent) {
    // Guard against unparseable server timestamps: persisting "NaN" would
    // poison every future sync's since parameter.
    const sinceEpoch = Math.floor(Date.parse(mostRecent) / 1000);
    if (Number.isFinite(sinceEpoch)) {
      await setSyncValue(db, "last_since", String(sinceEpoch));
    }
  }

  dataEvents.emit({ kind: "articles" });
  dataEvents.emit({ kind: "tags" });
  dataEvents.emit({ kind: "sync-status" });
}
