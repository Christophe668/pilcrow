import {
  listAnnotations as listLocalAnnotations,
  upsertAnnotations,
  type AnnotationRow,
} from "@/db/repos/annotations";
import { dataEvents } from "./events";
import type { Backend, BackendAnnotation } from "@/api/backend";
import type { DbDriver } from "@/db/driver";

/**
 * Pull-side of annotation sync. The outbox drainer pushes local edits up;
 * this module pulls server-side annotations down so highlights made on
 * another device (or in the server web UI) show up locally. Scoped to
 * articles that already have content — those are the ones the reader can
 * actually render highlights on.
 */

function annotationToRow(
  a: BackendAnnotation,
  articleLocalId: number,
  backend: Backend,
): Partial<AnnotationRow> {
  // The reader stores ranges in Wallabag's shape; map the backend-neutral
  // dom-range locators back to it.
  const ranges = a.locators
    .filter((l) => l.kind === "dom-range")
    .map((l) => ({
      start: l.startXPath,
      startOffset: l.startOffset,
      end: l.endXPath,
      endOffset: l.endOffset,
    }));
  const row: Partial<AnnotationRow> = {
    backend_id: a.id,
    article_id: articleLocalId,
    quote: a.quote,
    ranges_json: JSON.stringify(ranges),
    text: a.note,
    created_at: a.createdAt,
    updated_at: a.updatedAt,
    pending_op: null,
  };
  if (backend.capabilities.localIdMatchesBackendId) {
    const n = Number(a.id);
    if (Number.isFinite(n) && Number.isInteger(n)) row.id = n;
  }
  return row;
}

/**
 * Reconciles one article's local annotations against the server list.
 * Rows with pending_op set always win — the outbox drainer owns them
 * until the local edit lands. Returns whether anything changed and
 * emits an `annotations` data event so open readers re-render.
 */
export async function pullAnnotationsForArticle(
  db: DbDriver,
  backend: Backend,
  article: { id: number; backend_id: string },
): Promise<boolean> {
  const server = await backend.listAnnotations(article.backend_id);
  const local = await listLocalAnnotations(db, article.id);
  const localByBackendId = new Map(
    local.filter((r) => r.backend_id !== null).map((r) => [r.backend_id as string, r]),
  );

  const upserts: Partial<AnnotationRow>[] = [];
  for (const a of server) {
    const existing = localByBackendId.get(a.id);
    if (existing?.pending_op) continue;
    const row = annotationToRow(a, article.id, backend);
    if (existing) {
      const unchanged =
        existing.quote === row.quote &&
        existing.text === row.text &&
        existing.updated_at === row.updated_at &&
        existing.ranges_json === row.ranges_json;
      if (unchanged) continue;
      row.id = existing.id;
    }
    upserts.push(row);
  }

  const serverIds = new Set(server.map((a) => a.id));
  const staleIds = local
    .filter((r) => r.backend_id !== null && r.pending_op === null && !serverIds.has(r.backend_id))
    .map((r) => r.id);

  if (upserts.length === 0 && staleIds.length === 0) return false;

  await upsertAnnotations(db, upserts);
  for (const id of staleIds) {
    await db.run("DELETE FROM annotations WHERE id = ?", [id]);
  }
  dataEvents.emit({ kind: "annotations", articleId: article.id });
  return true;
}

/**
 * Pulls annotations for every article that has local content. A failure
 * on one article is logged and skipped so a single bad entry can't block
 * annotation sync for the rest of the library.
 */
export async function pullAnnotations(db: DbDriver, backend: Backend): Promise<void> {
  if (!backend.capabilities.annotations) return;
  const articles = await db.all<{ id: number; backend_id: string }>(
    `SELECT id, backend_id FROM articles
     WHERE backend_id IS NOT NULL AND content IS NOT NULL`,
  );
  for (const article of articles) {
    try {
      await pullAnnotationsForArticle(db, backend, article);
    } catch (e) {
      console.warn(`[annotations-pull] article ${article.id}:`, e);
    }
  }
}
