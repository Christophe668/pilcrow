import { rawRequest, request, requestText } from "./client";
import type { BookmarkPatch, BookmarkPatchResponse, BookmarkSummary } from "./types";

type Auth = { serverUrl: string; accessToken: string };

export type BookmarksPage = {
  items: BookmarkSummary[];
  totalCount: number | null;
  currentPage: number | null;
};

export type ListBookmarksArgs = {
  /** 1-indexed page number, or undefined for the first page. */
  page?: number;
  /** Default 50; Readeck caps at 100. */
  limit?: number;
  search?: string;
  labels?: string;
  is_archived?: boolean;
  is_marked?: boolean;
  has_labels?: boolean;
};

export async function listBookmarks(
  auth: Auth,
  args: ListBookmarksArgs = {},
): Promise<BookmarksPage> {
  const limit = args.limit ?? 50;
  const offset = args.page && args.page > 1 ? (args.page - 1) * limit : 0;
  const res = await rawRequest({
    ...auth,
    method: "GET",
    path: "/api/bookmarks",
    query: {
      limit,
      offset,
      search: args.search,
      labels: args.labels,
      is_archived: args.is_archived,
      is_marked: args.is_marked,
      has_labels: args.has_labels,
    },
  });
  const items = (await res.json()) as BookmarkSummary[];
  const totalRaw = res.headers.get("Total-Count");
  const pageRaw = res.headers.get("Current-Page");
  return {
    items,
    totalCount: totalRaw === null ? null : Number(totalRaw),
    currentPage: pageRaw === null ? null : Number(pageRaw),
  };
}

export async function getBookmark(auth: Auth, id: string): Promise<BookmarkSummary> {
  return request<BookmarkSummary>({
    ...auth,
    method: "GET",
    path: `/api/bookmarks/${encodeURIComponent(id)}`,
  });
}

/**
 * Fetches the article body. Returns the raw HTML string Readeck served;
 * the caller is responsible for stripping/sanitizing if needed (the
 * pilcrow reader already pipes content through DOMPurify equivalents).
 */
export async function getBookmarkArticle(auth: Auth, id: string): Promise<string> {
  return requestText({
    ...auth,
    method: "GET",
    path: `/api/bookmarks/${encodeURIComponent(id)}/article`,
  });
}

/**
 * Creates a bookmark. Readeck answers `202 Accepted` because extraction
 * runs asynchronously; the response body is empty and the new ID lives
 * in the `Bookmark-Id` response header. Use `pollBookmarkLoaded` to wait
 * until extraction finishes if the caller needs the full article.
 */
export async function createBookmark(
  auth: Auth,
  args: { url: string; labels?: readonly string[]; title?: string },
): Promise<{ id: string }> {
  const res = await rawRequest({
    ...auth,
    method: "POST",
    path: "/api/bookmarks",
    body: {
      url: args.url,
      ...(args.labels && args.labels.length > 0 ? { labels: args.labels } : {}),
      ...(args.title ? { title: args.title } : {}),
    },
  });
  const id = res.headers.get("Bookmark-Id");
  if (!id) {
    throw new Error("Readeck create-bookmark response missing Bookmark-Id header");
  }
  return { id };
}

export async function patchBookmark(
  auth: Auth,
  id: string,
  patch: BookmarkPatch,
): Promise<BookmarkPatchResponse> {
  return request<BookmarkPatchResponse>({
    ...auth,
    method: "PATCH",
    path: `/api/bookmarks/${encodeURIComponent(id)}`,
    body: patch,
  });
}

export async function deleteBookmark(auth: Auth, id: string): Promise<void> {
  await rawRequest({
    ...auth,
    method: "DELETE",
    path: `/api/bookmarks/${encodeURIComponent(id)}`,
  });
}

/**
 * Polls `getBookmark` until `loaded === true` or the timeout elapses.
 * Used after `createBookmark` so the caller can show full content
 * instead of a placeholder. Returns the loaded summary on success or
 * throws if the bookmark stays in the loading state past the timeout.
 */
export async function pollBookmarkLoaded(
  auth: Auth,
  id: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<BookmarkSummary> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const intervalMs = opts.intervalMs ?? 1_000;
  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const summary = await getBookmark(auth, id);
    if (summary.loaded) return summary;
    if (Date.now() >= deadline) {
      throw new Error(`Bookmark ${id} did not finish loading within ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
