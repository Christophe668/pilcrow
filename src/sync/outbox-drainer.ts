import { getDb } from "@/db";
import {
  peekDue,
  markFailure,
  markSuccess,
  type OutboxOp,
  type OutboxRow,
} from "@/db/repos/outbox";
import { clearPendingOp, deleteArticle } from "@/db/repos/articles";
import { rewriteAnnotationId, purgeDeleted } from "@/db/repos/annotations";
import { getBackend } from "@/api/backend";
import type { DbDriver } from "@/db/driver";
import { dataEvents } from "./events";

export type DrainSummary = { processed: number; failed: number };

const BATCH = 25;

/**
 * Outbox payloads carry local primary keys (numeric, persisted to disk).
 * The drainer translates each local id to the row's `backend_id` at
 * call time so the same payload schema works against either Wallabag
 * (where local id parses back to the server id) or Readeck (where
 * local id is autoincrement and the backend id is a UUID).
 */
type Payloads = {
  createEntry: { tempId: number; url: string; tags?: string[] };
  updateEntry: { id: number; is_starred?: 0 | 1; is_archived?: 0 | 1; tags?: string };
  deleteEntry: { id: number };
  addTag: { entryId: number; labels: string[] };
  removeTag: { entryId: number; tagId: number };
  createAnnotation: {
    tempId: number;
    entryId: number;
    quote: string;
    ranges: { start: string; startOffset: number; end: string; endOffset: number }[];
    text: string | null;
  };
  updateAnnotation: { id: number; text: string | null };
  deleteAnnotation: { id: number };
};

async function lookupBackendId(
  db: DbDriver,
  table: "articles" | "tags" | "annotations",
  localId: number,
): Promise<string> {
  const row = await db.get<{ backend_id: string | null }>(
    `SELECT backend_id FROM ${table} WHERE id = ?`,
    [localId],
  );
  if (!row || row.backend_id === null) {
    throw new Error(`Missing backend_id for ${table}.${localId} — outbox row stale?`);
  }
  return row.backend_id;
}

/**
 * Joins through `annotations` → `articles` to recover the backend id
 * of the article an annotation belongs to. Readeck's annotation
 * endpoints are nested under the bookmark, so the drainer needs both
 * ids; Wallabag's adapter just ignores the article id.
 */
async function lookupAnnotationArticleBackendId(
  db: DbDriver,
  annotationLocalId: number,
): Promise<string> {
  const row = await db.get<{ backend_id: string | null }>(
    `SELECT a.backend_id
       FROM articles a
       JOIN annotations n ON n.article_id = a.id
       WHERE n.id = ?`,
    [annotationLocalId],
  );
  if (!row || row.backend_id === null) {
    throw new Error(
      `Missing article backend_id for annotation ${annotationLocalId} — outbox row stale?`,
    );
  }
  return row.backend_id;
}

async function processOne(row: OutboxRow): Promise<void> {
  const op = row.op as OutboxOp;
  const payload = JSON.parse(row.payload_json) as Payloads[OutboxOp];
  const db = await getDb();
  const backend = getBackend();

  switch (op) {
    case "createEntry": {
      const p = payload as Payloads["createEntry"];
      const real = await backend.createArticle(p.url, p.tags);
      if (backend.capabilities.localIdMatchesBackendId) {
        // Wallabag path: replace the temp row with one keyed on the
        // server id, preserving the long-standing "local id == server id"
        // invariant for Wallabag installs.
        const realId = Number(real.id);
        await db.run("DELETE FROM articles WHERE id = ?", [p.tempId]);
        await db.run(
          `INSERT INTO articles (id, backend_id, title, url, domain_name,
              created_at, updated_at, server_updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
              backend_id = excluded.backend_id,
              title = excluded.title,
              updated_at = excluded.updated_at`,
          [
            realId,
            real.id,
            real.title,
            real.url,
            real.domainName,
            real.createdAt,
            real.updatedAt,
            real.updatedAt,
          ],
        );
      } else {
        // Readeck path: promote the temp row in place — local id stays
        // put, backend_id and metadata are filled in. Routes that
        // navigated to /article/<tempId> keep working.
        await db.run(
          `UPDATE articles
           SET backend_id = ?, title = ?, url = ?, domain_name = ?,
               created_at = ?, updated_at = ?, server_updated_at = ?,
               pending_op = NULL
           WHERE id = ?`,
          [
            real.id,
            real.title,
            real.url,
            real.domainName,
            real.createdAt,
            real.updatedAt,
            real.updatedAt,
            p.tempId,
          ],
        );
      }
      dataEvents.emit({ kind: "articles" });
      return;
    }
    case "updateEntry": {
      const p = payload as Payloads["updateEntry"];
      const backendId = await lookupBackendId(db, "articles", p.id);
      await backend.patchArticle(backendId, {
        ...(p.is_starred !== undefined ? { isStarred: p.is_starred === 1 } : {}),
        ...(p.is_archived !== undefined ? { isArchived: p.is_archived === 1 } : {}),
        ...(p.tags !== undefined
          ? {
              tagLabels: p.tags
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean),
            }
          : {}),
      });
      await clearPendingOp(db, p.id);
      dataEvents.emit({ kind: "article", id: p.id });
      dataEvents.emit({ kind: "articles" });
      return;
    }
    case "deleteEntry": {
      const p = payload as Payloads["deleteEntry"];
      const backendId = await lookupBackendId(db, "articles", p.id);
      await backend.deleteArticle(backendId);
      await deleteArticle(db, p.id);
      dataEvents.emit({ kind: "articles" });
      return;
    }
    case "addTag": {
      const p = payload as Payloads["addTag"];
      const backendId = await lookupBackendId(db, "articles", p.entryId);
      await backend.addTagsToArticle(backendId, p.labels);
      dataEvents.emit({ kind: "article", id: p.entryId });
      return;
    }
    case "removeTag": {
      const p = payload as Payloads["removeTag"];
      const articleBackendId = await lookupBackendId(db, "articles", p.entryId);
      const tagBackendId = await lookupBackendId(db, "tags", p.tagId);
      await backend.removeTagFromArticle(articleBackendId, tagBackendId);
      dataEvents.emit({ kind: "article", id: p.entryId });
      return;
    }
    case "createAnnotation": {
      const p = payload as Payloads["createAnnotation"];
      const articleBackendId = await lookupBackendId(db, "articles", p.entryId);
      const real = await backend.createAnnotation(articleBackendId, {
        quote: p.quote,
        note: p.text,
        locators: p.ranges.map((r) => ({
          kind: "dom-range",
          startXPath: r.start,
          startOffset: r.startOffset,
          endXPath: r.end,
          endOffset: r.endOffset,
        })),
      });
      // For Wallabag the real id parses back to an integer; for Readeck
      // it's a short-uid, so we must keep the local PK as the temp id
      // and only rewrite backend_id.
      if (backend.capabilities.localIdMatchesBackendId) {
        await rewriteAnnotationId(db, p.tempId, Number(real.id), real.id);
      } else {
        await db.run("UPDATE annotations SET backend_id = ?, pending_op = NULL WHERE id = ?", [
          real.id,
          p.tempId,
        ]);
      }
      dataEvents.emit({ kind: "annotations", articleId: p.entryId });
      return;
    }
    case "updateAnnotation": {
      const p = payload as Payloads["updateAnnotation"];
      const articleBackendId = await lookupAnnotationArticleBackendId(db, p.id);
      const annotationBackendId = await lookupBackendId(db, "annotations", p.id);
      await backend.updateAnnotation(articleBackendId, annotationBackendId, p.text);
      await db.run("UPDATE annotations SET pending_op = NULL WHERE id = ?", [p.id]);
      return;
    }
    case "deleteAnnotation": {
      const p = payload as Payloads["deleteAnnotation"];
      const articleBackendId = await lookupAnnotationArticleBackendId(db, p.id);
      const annotationBackendId = await lookupBackendId(db, "annotations", p.id);
      await backend.deleteAnnotation(articleBackendId, annotationBackendId);
      await purgeDeleted(db, p.id);
      return;
    }
  }
}

export async function drainOutbox(): Promise<DrainSummary> {
  const db = await getDb();
  const due = await peekDue(db, BATCH);
  let processed = 0;
  let failed = 0;
  for (const row of due) {
    try {
      await processOne(row);
      await markSuccess(db, row.id);
      processed += 1;
    } catch (e) {
      await markFailure(db, row.id, e instanceof Error ? e.message : String(e));
      failed += 1;
    }
  }
  if (processed > 0 || failed > 0) {
    dataEvents.emit({ kind: "sync-status" });
  }
  return { processed, failed };
}
