import { request } from "./client";
import type { BookmarkLabel } from "./types";

type Auth = { serverUrl: string; accessToken: string };

export async function listLabels(auth: Auth): Promise<BookmarkLabel[]> {
  return request<BookmarkLabel[]>({
    ...auth,
    method: "GET",
    path: "/api/bookmarks/labels",
  });
}
