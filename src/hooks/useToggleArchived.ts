import { useMutation } from "@tanstack/react-query";
import { getDb } from "@/db";
import { setArchived } from "@/db/repos/articles";
import { enqueue } from "@/db/repos/outbox";
import { dataEvents } from "@/sync/events";

export async function toggleArchivedAction(articleId: number, archived: boolean): Promise<void> {
  const db = await getDb();
  await setArchived(db, articleId, archived);
  await enqueue(db, "updateEntry", { id: articleId, is_archived: archived ? 1 : 0 });
  dataEvents.emit({ kind: "article", id: articleId });
  dataEvents.emit({ kind: "articles" });
}

export function useToggleArchived() {
  return useMutation({
    mutationFn: ({ id, archived }: { id: number; archived: boolean }) =>
      toggleArchivedAction(id, archived),
  });
}
