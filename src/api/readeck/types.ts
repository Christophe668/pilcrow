/**
 * TypeScript shapes for the Readeck API. Derived from the OpenAPI spec at
 * codeberg.org/readeck/readeck/src/branch/main/docs/api and verified
 * against a running 0.22.x instance.
 */

export type OAuthClientCreate = {
  client_name: string;
  client_uri: string;
  software_id: string;
  software_version: string;
  grant_types?: readonly string[];
  token_endpoint_auth_method?: "none";
  redirect_uris?: readonly string[];
};

export type OAuthClientResponse = {
  client_id: string;
  client_name: string;
  client_uri: string;
  software_id: string;
  software_version: string;
  grant_types: string[];
  response_types: string[];
};

export type DeviceAuthorizationResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
};

export type ReadeckTokenResponse = {
  id: string;
  access_token: string;
  token_type: "Bearer";
  scope: string;
};

export type OAuthErrorBody = {
  error:
    | "access_denied"
    | "authorization_pending"
    | "expired_token"
    | "invalid_client"
    | "invalid_grant"
    | "invalid_request"
    | "invalid_scope"
    | "server_error"
    | "slow_down"
    | "unauthorized_client";
  error_description?: string;
};

export type BookmarkSummary = {
  id: string;
  href: string;
  created: string;
  updated: string;
  state: 0 | 1 | 2;
  loaded: boolean;
  url: string;
  title: string;
  site_name: string;
  site: string;
  published: string | null;
  authors: string[];
  lang: string;
  text_direction: "ltr" | "rtl" | "";
  document_type: string;
  type: "article" | "photo" | "video";
  has_article: boolean;
  description: string;
  is_deleted: boolean;
  is_marked: boolean;
  is_archived: boolean;
  read_progress: number;
  labels: string[];
  word_count: number;
  reading_time: number;
  resources: {
    article?: { src: string };
    icon?: { src: string; width: number; height: number };
    image?: { src: string; width: number; height: number };
    thumbnail?: { src: string; width: number; height: number };
    log: { src: string };
    props: { src: string };
  };
};

export type BookmarkPatch = {
  is_archived?: boolean;
  is_marked?: boolean;
  is_deleted?: boolean;
  read_progress?: number;
  title?: string;
  add_labels?: readonly string[];
  remove_labels?: readonly string[];
  labels?: readonly string[];
};

export type BookmarkPatchResponse = {
  href: string;
  id: string;
  is_archived?: boolean;
  is_marked?: boolean;
  is_deleted?: boolean;
  labels?: string[];
  read_progress?: number;
  title?: string;
  updated: string;
};

export type BookmarkLabel = {
  name: string;
  count: number;
  href: string;
  href_bookmarks: string;
};

export type BookmarkSyncEntry = {
  id: string;
  time: string;
  type: "update" | "delete";
};

/**
 * Readeck annotations carry an XPath-based locator (start_selector +
 * start_offset, end_selector + end_offset) — the same shape Wallabag
 * uses, just with different field names. The server extracts the
 * highlighted `text` from the locator on create; the client provides
 * the color and an optional user note.
 */
export type ReadeckAnnotation = {
  id: string;
  text: string;
  color: string;
  note: string;
  created: string;
  start_selector: string;
  start_offset: number;
  end_selector: string;
  end_offset: number;
};

export type ReadeckAnnotationCreate = {
  color?: string;
  note?: string;
  start_selector: string;
  start_offset: number;
  end_selector: string;
  end_offset: number;
};

export type ReadeckAnnotationPatch = {
  color?: string;
  note?: string;
};
