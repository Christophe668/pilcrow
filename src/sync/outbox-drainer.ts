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
import { dataEvents } from "./events";

export type DrainSummary = { processed: number; failed: number };

const BATCH = 25;

/**
 * Outbox payloads keep their original numeric/0-1 shapes — they're
 * persisted to SQLite, so changing the schema would orphan in-flight
 * rows on existing installs. The drainer converts to the Backend
 * interface's normalized shape at the call boundary.
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

async function processOne(row: OutboxRow): Promise<void> {
  const op = row.op as OutboxOp;
  const payload = JSON.parse(row.payload_json) as Payloads[OutboxOp];
  const db = await getDb();
  const backend = getBackend();

  switch (op) {
    case "createEntry": {
      const p = payload as Payloads["createEntry"];
      const real = await backend.createArticle(p.url, p.tags);
      const realId = Number(real.id);
      await db.run("DELETE FROM articles WHERE id = ?", [p.tempId]);
      await db.run(
        `INSERT INTO articles (id, backend_id, title, url, domain_name, created_at, updated_at, server_updated_at)
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
      dataEvents.emit({ kind: "articles" });
      return;
    }
    case "updateEntry": {
      const p = payload as Payloads["updateEntry"];
      await backend.patchArticle(String(p.id), {
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
      await backend.deleteArticle(String(p.id));
      await deleteArticle(db, p.id);
      dataEvents.emit({ kind: "articles" });
      return;
    }
    case "addTag": {
      const p = payload as Payloads["addTag"];
      await backend.addTagsToArticle(String(p.entryId), p.labels);
      dataEvents.emit({ kind: "article", id: p.entryId });
      return;
    }
    case "removeTag": {
      const p = payload as Payloads["removeTag"];
      await backend.removeTagFromArticle(String(p.entryId), String(p.tagId));
      dataEvents.emit({ kind: "article", id: p.entryId });
      return;
    }
    case "createAnnotation": {
      const p = payload as Payloads["createAnnotation"];
      const real = await backend.createAnnotation(String(p.entryId), {
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
      await rewriteAnnotationId(db, p.tempId, Number(real.id), real.id);
      dataEvents.emit({ kind: "annotations", articleId: p.entryId });
      return;
    }
    case "updateAnnotation": {
      const p = payload as Payloads["updateAnnotation"];
      await backend.updateAnnotation(String(p.id), p.text);
      await db.run("UPDATE annotations SET pending_op = NULL WHERE id = ?", [p.id]);
      return;
    }
    case "deleteAnnotation": {
      const p = payload as Payloads["deleteAnnotation"];
      await backend.deleteAnnotation(String(p.id));
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
