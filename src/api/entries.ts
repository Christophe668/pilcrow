import { authedRequest } from "./client";
import type { Entry, EntriesPage, EntryDetail } from "./types";

export async function listEntries(args: {
  page: number;
  perPage: number;
  detail: EntryDetail;
  since?: number;
  archive?: 0 | 1;
  starred?: 0 | 1;
  tags?: string;
}): Promise<EntriesPage> {
  const query: Record<string, string | number | undefined> = {
    page: args.page,
    perPage: args.perPage,
    detail: args.detail,
  };
  if (args.since !== undefined) query["since"] = args.since;
  if (args.archive !== undefined) query["archive"] = args.archive;
  if (args.starred !== undefined) query["starred"] = args.starred;
  if (args.tags !== undefined) query["tags"] = args.tags;
  return authedRequest<EntriesPage>({
    method: "GET",
    path: "/api/entries.json",
    query,
  });
}

export async function getEntry(id: number): Promise<Entry> {
  return authedRequest<Entry>({ method: "GET", path: `/api/entries/${id}.json` });
}

export async function createEntry(url: string, tags?: readonly string[]): Promise<Entry> {
  return authedRequest<Entry>({
    method: "POST",
    path: "/api/entries.json",
    body: { url, ...(tags && tags.length ? { tags: tags.join(",") } : {}) },
  });
}

// Wallabag's PATCH expects `archive` / `starred`, not `is_archived` / `is_starred`.
export async function updateEntry(
  id: number,
  patch: { is_archived?: 0 | 1; is_starred?: 0 | 1; tags?: string },
): Promise<Entry> {
  const body: Record<string, unknown> = {};
  if (patch.is_archived !== undefined) body["archive"] = patch.is_archived;
  if (patch.is_starred !== undefined) body["starred"] = patch.is_starred;
  if (patch.tags !== undefined) body["tags"] = patch.tags;
  return authedRequest<Entry>({
    method: "PATCH",
    path: `/api/entries/${id}.json`,
    body,
  });
}

export async function deleteEntry(id: number): Promise<void> {
  await authedRequest<unknown>({ method: "DELETE", path: `/api/entries/${id}.json` });
}
