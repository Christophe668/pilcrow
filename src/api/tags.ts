import { authedRequest } from "./client";
import type { EntryTag } from "./types";

export async function listTags(): Promise<EntryTag[]> {
  return authedRequest<EntryTag[]>({ method: "GET", path: "/api/tags.json" });
}

export async function addTagsToEntry(entryId: number, labels: readonly string[]): Promise<void> {
  await authedRequest<unknown>({
    method: "POST",
    path: `/api/entries/${entryId}/tags.json`,
    body: { tags: labels.join(",") },
  });
}

export async function removeTagFromEntry(entryId: number, tagId: number): Promise<void> {
  await authedRequest<unknown>({
    method: "DELETE",
    path: `/api/entries/${entryId}/tags/${tagId}.json`,
  });
}
