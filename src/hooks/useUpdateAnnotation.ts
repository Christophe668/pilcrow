import { useMutation } from "@tanstack/react-query";
import { getDb } from "@/db";
import { enqueue } from "@/db/repos/outbox";
import { dataEvents } from "@/sync/events";

export async function updateAnnotationAction(id: number, text: string | null): Promise<void> {
  const db = await getDb();
  await db.run(
    `UPDATE annotations SET text = ?, pending_op = 'update', updated_at = ? WHERE id = ?`,
    [text, new Date().toISOString(), id],
  );
  await enqueue(db, "updateAnnotation", { id, text });
  const row = await db.get<{ article_id: number }>(
    "SELECT article_id FROM annotations WHERE id = ?",
    [id],
  );
  if (row) dataEvents.emit({ kind: "annotations", articleId: row.article_id });
}

export function useUpdateAnnotation() {
  return useMutation({
    mutationFn: ({ id, text }: { id: number; text: string | null }) =>
      updateAnnotationAction(id, text),
  });
}
