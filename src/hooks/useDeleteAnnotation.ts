import { useMutation } from "@tanstack/react-query";
import { getDb } from "@/db";
import { deleteAnnotation as repoDelete } from "@/db/repos/annotations";
import { enqueue } from "@/db/repos/outbox";
import { dataEvents } from "@/sync/events";

export async function deleteAnnotationAction(id: number): Promise<void> {
  const db = await getDb();
  const row = await db.get<{ article_id: number }>(
    "SELECT article_id FROM annotations WHERE id = ?",
    [id],
  );
  await repoDelete(db, id);
  await enqueue(db, "deleteAnnotation", { id });
  if (row) dataEvents.emit({ kind: "annotations", articleId: row.article_id });
}

export function useDeleteAnnotation() {
  return useMutation({
    mutationFn: (id: number) => deleteAnnotationAction(id),
  });
}
