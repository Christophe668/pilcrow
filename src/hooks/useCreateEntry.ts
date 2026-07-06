import { useMutation } from "@tanstack/react-query";
import { getDb } from "@/db";
import { upsertArticles } from "@/db/repos/articles";
import { enqueue } from "@/db/repos/outbox";
import { dataEvents } from "@/sync/events";

let nextTempId = -1;

export async function createEntryAction(url: string, tags?: readonly string[]): Promise<number> {
  const db = await getDb();
  // Seed below any temp row already persisted — the in-memory counter
  // resets on restart and must not collide with undrained offline saves.
  const minRow = await db.get<{ min: number | null }>("SELECT MIN(id) AS min FROM articles");
  const tempId = Math.min(nextTempId, Math.min(0, minRow?.min ?? 0) - 1);
  nextTempId = tempId - 1;
  const now = new Date().toISOString();

  await upsertArticles(db, [
    {
      id: tempId,
      title: url,
      url,
      pending_op: "create",
      created_at: now,
      updated_at: now,
      local_updated_at: now,
    },
  ]);

  const payload: { tempId: number; url: string; tags?: string[] } = { tempId, url };
  if (tags && tags.length > 0) payload.tags = [...tags];
  await enqueue(db, "createEntry", payload);

  dataEvents.emit({ kind: "articles" });
  return tempId;
}

export function useCreateEntry() {
  return useMutation({
    mutationFn: ({ url, tags }: { url: string; tags?: readonly string[] }) =>
      createEntryAction(url, tags),
  });
}
