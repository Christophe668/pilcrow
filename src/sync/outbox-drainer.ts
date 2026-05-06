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
import { createEntry, updateEntry, deleteEntry } from "@/api/entries";
import { addTagsToEntry, removeTagFromEntry } from "@/api/tags";
import {
  createAnnotation as apiCreateAnnotation,
  updateAnnotation as apiUpdateAnnotation,
  deleteAnnotation as apiDeleteAnnotation,
} from "@/api/annotations";
import { dataEvents } from "./events";

export type DrainSummary = { processed: number; failed: number };

const BATCH = 25;

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

  switch (op) {
    case "createEntry": {
      const p = payload as Payloads["createEntry"];
      const real = await createEntry(p.url, p.tags);
      await db.run("DELETE FROM articles WHERE id = ?", [p.tempId]);
      await db.run(
        `INSERT INTO articles (id, title, url, domain_name, created_at, updated_at, server_updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at`,
        [
          real.id,
          real.title,
          real.url,
          real.domain_name,
          real.created_at,
          real.updated_at,
          real.updated_at,
        ],
      );
      dataEvents.emit({ kind: "articles" });
      return;
    }
    case "updateEntry": {
      const p = payload as Payloads["updateEntry"];
      await updateEntry(p.id, {
        ...(p.is_starred !== undefined ? { is_starred: p.is_starred } : {}),
        ...(p.is_archived !== undefined ? { is_archived: p.is_archived } : {}),
        ...(p.tags !== undefined ? { tags: p.tags } : {}),
      });
      await clearPendingOp(db, p.id);
      dataEvents.emit({ kind: "article", id: p.id });
      dataEvents.emit({ kind: "articles" });
      return;
    }
    case "deleteEntry": {
      const p = payload as Payloads["deleteEntry"];
      await deleteEntry(p.id);
      await deleteArticle(db, p.id);
      dataEvents.emit({ kind: "articles" });
      return;
    }
    case "addTag": {
      const p = payload as Payloads["addTag"];
      await addTagsToEntry(p.entryId, p.labels);
      dataEvents.emit({ kind: "article", id: p.entryId });
      return;
    }
    case "removeTag": {
      const p = payload as Payloads["removeTag"];
      await removeTagFromEntry(p.entryId, p.tagId);
      dataEvents.emit({ kind: "article", id: p.entryId });
      return;
    }
    case "createAnnotation": {
      const p = payload as Payloads["createAnnotation"];
      const real = await apiCreateAnnotation(p.entryId, {
        quote: p.quote,
        ranges: p.ranges,
        text: p.text,
      });
      await rewriteAnnotationId(db, p.tempId, real.id);
      dataEvents.emit({ kind: "annotations", articleId: p.entryId });
      return;
    }
    case "updateAnnotation": {
      const p = payload as Payloads["updateAnnotation"];
      await apiUpdateAnnotation(p.id, { text: p.text });
      await db.run("UPDATE annotations SET pending_op = NULL WHERE id = ?", [p.id]);
      return;
    }
    case "deleteAnnotation": {
      const p = payload as Payloads["deleteAnnotation"];
      await apiDeleteAnnotation(p.id);
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
