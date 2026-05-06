import { useMutation } from "@tanstack/react-query";
import { getDb } from "@/db";
import { deleteArticle } from "@/db/repos/articles";
import { enqueue } from "@/db/repos/outbox";
import { dataEvents } from "@/sync/events";

export async function deleteArticleAction(articleId: number): Promise<void> {
  const db = await getDb();
  await enqueue(db, "deleteEntry", { id: articleId });
  await deleteArticle(db, articleId);
  dataEvents.emit({ kind: "articles" });
}

export function useDeleteArticle() {
  return useMutation({
    mutationFn: (id: number) => deleteArticleAction(id),
  });
}
