/**
 * Backend abstraction — the seam between pilcrow and the read-it-later
 * server it talks to. Today only Wallabag is implemented; a future
 * Readeck adapter slots in behind the same interface.
 *
 * IDs are strings here even though Wallabag uses integers, because
 * Readeck uses UUIDs. Adapters round-trip the conversion at their
 * boundary; consumers (sync engine, hooks) cast back to numbers when
 * writing to the local SQLite schema, which still uses INTEGER PKs.
 * Migrating the schema to TEXT is a follow-up step.
 */

export type BackendKind = "wallabag" | "readeck";

export type ArticleId = string;
export type TagId = string;
export type AnnotationId = string;

export type Article = {
  id: ArticleId;
  title: string | null;
  url: string;
  domainName: string | null;
  content: string | null;
  previewPicture: string | null;
  readingTime: number | null;
  language: string | null;
  isArchived: boolean;
  isStarred: boolean;
  createdAt: string;
  updatedAt: string;
  starredAt: string | null;
  archivedAt: string | null;
  publishedAt: string | null;
  authors: string[];
  tags: BackendTag[];
};

export type BackendTag = {
  id: TagId;
  label: string;
  slug: string;
};

export type AnnotationLocator =
  | {
      kind: "dom-range";
      startXPath: string;
      startOffset: number;
      endXPath: string;
      endOffset: number;
    }
  | { kind: "text-offset"; start: number; end: number };

export type BackendAnnotation = {
  id: AnnotationId;
  articleId: ArticleId;
  quote: string;
  note: string | null;
  // Array because Wallabag annotations carry one entry per text-range.
  // Readeck stores a single locator; its adapter wraps it in a 1-length array.
  locators: AnnotationLocator[];
  createdAt: string;
  updatedAt: string;
};

export type ArticlesPage = {
  items: Article[];
  page: number;
  totalPages: number;
  total: number;
};

export type ListArticlesArgs = {
  page: number;
  perPage: number;
  detail: "metadata" | "full";
  since?: number;
  archived?: boolean;
  starred?: boolean;
  tagSlug?: string;
};

export type ArticlePatch = {
  isArchived?: boolean;
  isStarred?: boolean;
  tagLabels?: readonly string[];
};

export type CreateAnnotationInput = {
  quote: string;
  note: string | null;
  locators: AnnotationLocator[];
};

export type Capabilities = {
  reloadArticle: boolean;
  annotations: boolean;
  /**
   * Whether the backend's external IDs are integers that can safely
   * double as local SQLite primary keys. Wallabag: `true`; Readeck: `false`.
   * The sync engine reads this to decide whether to pin local id =
   * Number(backend_id) (preserving today's Wallabag semantics) or to
   * let SQLite autoincrement assign a new local id (Readeck UUIDs
   * can't be used as INTEGER PKs).
   */
  localIdMatchesBackendId: boolean;
};

export interface Backend {
  readonly kind: BackendKind;
  readonly capabilities: Capabilities;

  listArticles(args: ListArticlesArgs): Promise<ArticlesPage>;
  getArticle(id: ArticleId): Promise<Article>;
  createArticle(url: string, tagLabels?: readonly string[]): Promise<Article>;
  patchArticle(id: ArticleId, patch: ArticlePatch): Promise<Article>;
  deleteArticle(id: ArticleId): Promise<void>;
  reloadArticle(id: ArticleId): Promise<Article>;

  listTags(): Promise<BackendTag[]>;
  addTagsToArticle(articleId: ArticleId, labels: readonly string[]): Promise<void>;
  removeTagFromArticle(articleId: ArticleId, tagId: TagId): Promise<void>;

  listAnnotations(articleId: ArticleId): Promise<BackendAnnotation[]>;
  createAnnotation(articleId: ArticleId, input: CreateAnnotationInput): Promise<BackendAnnotation>;
  /**
   * Both ids are required — Wallabag annotations are addressed by their
   * own id alone, but Readeck nests annotations under the bookmark, so
   * the adapter needs both. Wallabag's adapter ignores `articleId`.
   */
  updateAnnotation(articleId: ArticleId, id: AnnotationId, note: string | null): Promise<void>;
  deleteAnnotation(articleId: ArticleId, id: AnnotationId): Promise<void>;
}
