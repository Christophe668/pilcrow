import {
  listEntries as wbListEntries,
  getEntry as wbGetEntry,
  createEntry as wbCreateEntry,
  updateEntry as wbUpdateEntry,
  deleteEntry as wbDeleteEntry,
  reloadEntry as wbReloadEntry,
} from "@/api/entries";
import {
  listTags as wbListTags,
  addTagsToEntry as wbAddTagsToEntry,
  removeTagFromEntry as wbRemoveTagFromEntry,
} from "@/api/tags";
import {
  listAnnotations as wbListAnnotations,
  createAnnotation as wbCreateAnnotation,
  updateAnnotation as wbUpdateAnnotation,
  deleteAnnotation as wbDeleteAnnotation,
} from "@/api/annotations";
import type { Annotation as WbAnnotation, Entry, EntryTag } from "@/api/types";
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

function entryToArticle(e: Entry): Article {
  return {
    id: String(e.id),
    title: e.title,
    url: e.url,
    domainName: e.domain_name,
    content: e.content,
    previewPicture: e.preview_picture,
    readingTime: e.reading_time,
    language: e.language,
    isArchived: e.is_archived === 1,
    isStarred: e.is_starred === 1,
    createdAt: e.created_at,
    updatedAt: e.updated_at,
    starredAt: e.starred_at,
    archivedAt: e.archived_at,
    publishedAt: e.published_at,
    authors: e.published_by ?? [],
    tags: e.tags.map(tagToBackendTag),
  };
}

function tagToBackendTag(t: EntryTag): BackendTag {
  return { id: String(t.id), label: t.label, slug: t.slug };
}

function annotationToBackend(a: WbAnnotation, articleId: string): BackendAnnotation {
  return {
    id: String(a.id),
    articleId,
    quote: a.quote,
    note: a.text,
    locators: a.ranges.map((r) => ({
      kind: "dom-range",
      startXPath: r.start,
      startOffset: r.startOffset,
      endXPath: r.end,
      endOffset: r.endOffset,
    })),
    createdAt: a.created_at,
    updatedAt: a.updated_at,
  };
}

export const WallabagBackend: Backend = {
  kind: "wallabag",
  capabilities: { reloadArticle: true, annotations: true },

  async listArticles(args: ListArticlesArgs): Promise<ArticlesPage> {
    const result = await wbListEntries({
      page: args.page,
      perPage: args.perPage,
      detail: args.detail,
      ...(args.since !== undefined ? { since: args.since } : {}),
      ...(args.archived !== undefined ? ({ archive: args.archived ? 1 : 0 } as const) : {}),
      ...(args.starred !== undefined ? ({ starred: args.starred ? 1 : 0 } as const) : {}),
      ...(args.tagSlug !== undefined ? { tags: args.tagSlug } : {}),
    });
    return {
      items: result._embedded.items.map(entryToArticle),
      page: result.page,
      totalPages: result.pages,
      total: result.total,
    };
  },

  async getArticle(id) {
    return entryToArticle(await wbGetEntry(Number(id)));
  },

  async createArticle(url, tagLabels) {
    return entryToArticle(await wbCreateEntry(url, tagLabels));
  },

  async patchArticle(id, patch: ArticlePatch) {
    const body: Parameters<typeof wbUpdateEntry>[1] = {};
    if (patch.isArchived !== undefined) body.is_archived = patch.isArchived ? 1 : 0;
    if (patch.isStarred !== undefined) body.is_starred = patch.isStarred ? 1 : 0;
    if (patch.tagLabels !== undefined) body.tags = patch.tagLabels.join(",");
    return entryToArticle(await wbUpdateEntry(Number(id), body));
  },

  async deleteArticle(id) {
    await wbDeleteEntry(Number(id));
  },

  async reloadArticle(id) {
    return entryToArticle(await wbReloadEntry(Number(id)));
  },

  async listTags() {
    return (await wbListTags()).map(tagToBackendTag);
  },

  async addTagsToArticle(articleId, labels) {
    await wbAddTagsToEntry(Number(articleId), labels);
  },

  async removeTagFromArticle(articleId, tagId) {
    await wbRemoveTagFromEntry(Number(articleId), Number(tagId));
  },

  async listAnnotations(articleId) {
    const list = await wbListAnnotations(Number(articleId));
    return list.map((a) => annotationToBackend(a, articleId));
  },

  async createAnnotation(articleId, input: CreateAnnotationInput) {
    const ranges = input.locators.map((loc) => {
      if (loc.kind !== "dom-range") {
        throw new Error("Wallabag requires dom-range locators");
      }
      return {
        start: loc.startXPath,
        startOffset: loc.startOffset,
        end: loc.endXPath,
        endOffset: loc.endOffset,
      };
    });
    const created = await wbCreateAnnotation(Number(articleId), {
      quote: input.quote,
      text: input.note,
      ranges,
    });
    return annotationToBackend(created, articleId);
  },

  async updateAnnotation(id, note) {
    await wbUpdateAnnotation(Number(id), { text: note });
  },

  async deleteAnnotation(id) {
    await wbDeleteAnnotation(Number(id));
  },
};
