import { useMutation } from "@tanstack/react-query";
import { getDb } from "@/db";
import { setStarred } from "@/db/repos/articles";
import { enqueue } from "@/db/repos/outbox";
import { dataEvents } from "@/sync/events";

export async function toggleStarredAction(articleId: number, starred: boolean): Promise<void> {
  const db = await getDb();
  await setStarred(db, articleId, starred);
  await enqueue(db, "updateEntry", { id: articleId, is_starred: starred ? 1 : 0 });
  dataEvents.emit({ kind: "article", id: articleId });
  dataEvents.emit({ kind: "articles" });
}

export function useToggleStarred() {
  return useMutation({
    mutationFn: ({ id, starred }: { id: number; starred: boolean }) =>
      toggleStarredAction(id, starred),
  });
}
