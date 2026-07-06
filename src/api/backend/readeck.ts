import { kvGet } from "@/lib/async-storage";
import { secureGet } from "@/auth/storage";
import {
  listBookmarks,
  getBookmark,
  getBookmarkArticle,
  createBookmark,
  patchBookmark,
  deleteBookmark,
  pollBookmarkLoaded,
} from "@/api/readeck/bookmarks";
import { listLabels } from "@/api/readeck/labels";
import {
  listAnnotations,
  createAnnotation,
  updateAnnotation,
  deleteAnnotation,
} from "@/api/readeck/annotations";
import type { BookmarkSummary, ReadeckAnnotation } from "@/api/readeck/types";
import type {
  Article,
  ArticlePatch,
  ArticlesPage,
  Backend,
  BackendAnnotation,
  BackendTag,
  CreateAnnotationInput,
  ListArticlesArgs,
} from "./types";

async function getAuth(): Promise<{ serverUrl: string; accessToken: string }> {
  const serverUrl = await kvGet("server_url");
  const accessToken = await secureGet("access_token");
  if (!serverUrl) throw new Error("Readeck backend: server_url not set");
  if (!accessToken) throw new Error("Readeck backend: access_token not set");
  return { serverUrl, accessToken };
}

function pickPreviewPicture(b: BookmarkSummary): string | null {
  return b.resources.image?.src ?? b.resources.thumbnail?.src ?? null;
}

function bookmarkToArticle(b: BookmarkSummary, contentHtml: string | null = null): Article {
  return {
    id: b.id,
    title: b.title || null,
    url: b.url,
    domainName: b.site || null,
    content: contentHtml,
    previewPicture: pickPreviewPicture(b),
    readingTime: b.reading_time || null,
    language: b.lang || null,
    isArchived: b.is_archived,
    isStarred: b.is_marked,
    createdAt: b.created,
    updatedAt: b.updated,
    starredAt: null,
    archivedAt: null,
    publishedAt: b.published,
    authors: b.authors,
    // Readeck labels are bare strings — synthesize a BackendTag with
    // backend_id == slug == label so the schema-level resolution flow
    // works without invented integer ids.
    tags: b.labels.map((label): BackendTag => ({ id: label, label, slug: label })),
  };
}

function annotationToBackend(a: ReadeckAnnotation, articleId: string): BackendAnnotation {
  return {
    id: a.id,
    articleId,
    quote: a.text,
    note: a.note || null,
    locators: [
      {
        kind: "dom-range",
        startXPath: a.start_selector,
        startOffset: a.start_offset,
        endXPath: a.end_selector,
        endOffset: a.end_offset,
      },
    ],
    createdAt: a.created,
    updatedAt: a.created,
  };
}

export const ReadeckBackend: Backend = {
  kind: "readeck",
  capabilities: {
    reloadArticle: false,
    annotations: true,
    localIdMatchesBackendId: false,
  },

  async listArticles(args: ListArticlesArgs): Promise<ArticlesPage> {
    const auth = await getAuth();
    const result = await listBookmarks(auth, {
      page: args.page,
      limit: args.perPage,
      ...(args.archived !== undefined ? { is_archived: args.archived } : {}),
      ...(args.starred !== undefined ? { is_marked: args.starred } : {}),
      ...(args.tagSlug !== undefined ? { labels: args.tagSlug } : {}),
    });
    // Total-Count can be missing (CORS without Access-Control-Expose-Headers,
    // header-stripping proxies). Falling back to items.length would report
    // totalPages=1 and silently truncate the sync to one page — instead,
    // keep advertising "one more page" until the server returns a short page.
    const page = result.currentPage ?? args.page;
    const totalPages =
      result.totalCount != null
        ? Math.max(1, Math.ceil(result.totalCount / args.perPage))
        : result.items.length < args.perPage
          ? page
          : page + 1;
    const total = result.totalCount ?? (page - 1) * args.perPage + result.items.length;
    return {
      items: result.items.map((b) => bookmarkToArticle(b)),
      page,
      totalPages,
      total,
    };
  },

  async getArticle(id) {
    const auth = await getAuth();
    const summary = await getBookmark(auth, id);
    // Only fetch HTML when extraction is done; otherwise return without
    // content so the caller doesn't get a half-extracted article.
    let html: string | null = null;
    if (summary.loaded && summary.has_article && summary.resources.article?.src) {
      html = await getBookmarkArticle(auth, id).catch(() => null);
    }
    return bookmarkToArticle(summary, html);
  },

  async createArticle(url, tagLabels) {
    const auth = await getAuth();
    const { id } = await createBookmark(auth, {
      url,
      ...(tagLabels && tagLabels.length > 0 ? { labels: tagLabels } : {}),
    });
    // Wait briefly for extraction; if the server is slow, return the
    // partial summary so the UI can show the new article instead of
    // hanging. The next sync will fill in the body.
    const summary = await pollBookmarkLoaded(auth, id, {
      timeoutMs: 8_000,
      intervalMs: 500,
    }).catch(() => getBookmark(auth, id));
    return bookmarkToArticle(summary);
  },

  async patchArticle(id, patch: ArticlePatch) {
    const auth = await getAuth();
    const body: Parameters<typeof patchBookmark>[2] = {};
    if (patch.isArchived !== undefined) body.is_archived = patch.isArchived;
    if (patch.isStarred !== undefined) body.is_marked = patch.isStarred;
    if (patch.tagLabels !== undefined) body.labels = patch.tagLabels;
    await patchBookmark(auth, id, body);
    // The PATCH response is a partial; fetch the full bookmark so the
    // adapter contract (returning a full Article) holds.
    return bookmarkToArticle(await getBookmark(auth, id));
  },

  async deleteArticle(id) {
    const auth = await getAuth();
    await deleteBookmark(auth, id);
  },

  async reloadArticle() {
    throw new Error("Readeck does not support article reload");
  },

  async listTags() {
    const auth = await getAuth();
    const labels = await listLabels(auth);
    return labels.map((l): BackendTag => ({ id: l.name, label: l.name, slug: l.name }));
  },

  async addTagsToArticle(articleId, labels) {
    const auth = await getAuth();
    await patchBookmark(auth, articleId, { add_labels: labels });
  },

  async removeTagFromArticle(articleId, tagId) {
    const auth = await getAuth();
    // tagId here is the synthesized backend_id == label string.
    await patchBookmark(auth, articleId, { remove_labels: [tagId] });
  },

  async listAnnotations(articleId) {
    const auth = await getAuth();
    const list = await listAnnotations(auth, articleId);
    return list.map((a) => annotationToBackend(a, articleId));
  },

  async createAnnotation(articleId, input: CreateAnnotationInput) {
    const auth = await getAuth();
    const loc = input.locators[0];
    if (!loc || loc.kind !== "dom-range") {
      throw new Error("Readeck requires a single dom-range locator");
    }
    const created = await createAnnotation(auth, articleId, {
      start_selector: loc.startXPath,
      start_offset: loc.startOffset,
      end_selector: loc.endXPath,
      end_offset: loc.endOffset,
      ...(input.note ? { note: input.note } : {}),
    });
    return annotationToBackend(created, articleId);
  },

  async updateAnnotation(articleId, id, note) {
    const auth = await getAuth();
    await updateAnnotation(auth, articleId, id, { note: note ?? "" });
  },

  async deleteAnnotation(articleId, id) {
    const auth = await getAuth();
    await deleteAnnotation(auth, articleId, id);
  },
};
