import { WallabagBackend } from "./wallabag";
import { ReadeckBackend } from "./readeck";
import type { Backend, BackendKind } from "./types";

/**
 * Synchronous active-backend cache. Populated by `setActiveBackend`
 * during sign-in and during app boot (after `kvGet("backend_kind")`
 * resolves). Defaults to Wallabag because every previous pilcrow
 * install pre-dates the multi-backend split — those users never
 * touched the kind storage slot, and reading "wallabag" preserves
 * their behavior.
 */
let active: Backend = WallabagBackend;

export function getBackend(): Backend {
  return active;
}

export function setActiveBackend(kind: BackendKind): void {
  active = kind === "readeck" ? ReadeckBackend : WallabagBackend;
}

export function adapterForKind(kind: BackendKind): Backend {
  return kind === "readeck" ? ReadeckBackend : WallabagBackend;
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
