export type TokenBundle = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: "bearer";
};

export type WallabagInfo = {
  appname: "wallabag";
  version: string;
  allowed_registration?: boolean;
};

export type EntryTag = {
  id: number;
  label: string;
  slug: string;
};

export type Entry = {
  id: number;
  title: string | null;
  url: string;
  domain_name: string | null;
  content: string | null;
  preview_picture: string | null;
  reading_time: number | null;
  language: string | null;
  is_archived: 0 | 1;
  is_starred: 0 | 1;
  created_at: string;
  updated_at: string;
  starred_at: string | null;
  archived_at: string | null;
  published_at: string | null;
  published_by: string[] | null;
  tags: EntryTag[];
};

export type EntriesPage = {
  page: number;
  pages: number;
  limit: number;
  total: number;
  _embedded: { items: Entry[] };
};

export type EntryDetail = "metadata" | "full";
