import { useMutation } from "@tanstack/react-query";
import { getDb } from "@/db";
import { deleteArticle } from "@/db/repos/articles";
import { enqueue } from "@/db/repos/outbox";
import { dataEvents } from "@/sync/events";

export async function deleteArticleAction(articleId: number): Promise<void> {
  const db = await getDb();
  // The local row is hard-deleted below, so the outbox payload must carry
  // the backend id now — the drainer can't look it up later.
  const row = await db.get<{ backend_id: string | null }>(
    "SELECT backend_id FROM articles WHERE id = ?",
    [articleId],
  );
  if (row?.backend_id) {
    await enqueue(db, "deleteEntry", { id: articleId, backendId: row.backend_id });
  } else {
    // Never reached the server (offline save whose create hasn't drained):
    // cancel the queued create instead of queueing a delete.
    const creates = await db.all<{ id: number; payload_json: string }>(
      "SELECT id, payload_json FROM outbox WHERE op = 'createEntry'",
    );
    for (const c of creates) {
      try {
        const p = JSON.parse(c.payload_json) as { tempId?: number };
        if (p.tempId === articleId) await db.run("DELETE FROM outbox WHERE id = ?", [c.id]);
      } catch {
        // unparseable payload — leave it for the drainer to surface
      }
    }
  }
  await deleteArticle(db, articleId);
  dataEvents.emit({ kind: "articles" });
}

export function useDeleteArticle() {
  return useMutation({
    mutationFn: (id: number) => deleteArticleAction(id),
  });
}
