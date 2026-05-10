import { WallabagBackend } from "./wallabag";
import type { Backend } from "./types";

/**
 * Returns the active backend. Today only Wallabag is wired up; when a
 * Readeck adapter lands, this will read the backend kind from session
 * storage and dispatch.
 */
export function getBackend(): Backend {
  return WallabagBackend;
}

export type {
  AnnotationId,
  AnnotationLocator,
  Article,
  ArticleId,
  ArticlePatch,
  ArticlesPage,
  Backend,
  BackendAnnotation,
  BackendKind,
  BackendTag,
  Capabilities,
  CreateAnnotationInput,
  ListArticlesArgs,
  TagId,
} from "./types";
