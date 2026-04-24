-- 001_initial: tables for articles, tags, annotations, outbox, sync state.
-- FTS5 virtual table is added in Phase 3 by a later migration.

CREATE TABLE articles (
  id INTEGER PRIMARY KEY,
  title TEXT,
  url TEXT NOT NULL,
  domain_name TEXT,
  content TEXT,
  preview_picture TEXT,
  reading_time INTEGER,
  language TEXT,
  is_archived INTEGER NOT NULL DEFAULT 0,
  is_starred INTEGER NOT NULL DEFAULT 0,
  created_at TEXT,
  updated_at TEXT,
  starred_at TEXT,
  archived_at TEXT,
  published_at TEXT,
  published_by TEXT,
  scroll_position REAL NOT NULL DEFAULT 0,
  server_updated_at TEXT,
  local_updated_at TEXT,
  pending_op TEXT
) STRICT;

CREATE INDEX idx_articles_archived ON articles(is_archived, updated_at DESC);
CREATE INDEX idx_articles_starred ON articles(is_starred, updated_at DESC);
CREATE INDEX idx_articles_pending ON articles(pending_op) WHERE pending_op IS NOT NULL;

CREATE TABLE tags (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE
) STRICT;

CREATE TABLE article_tags (
  article_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (article_id, tag_id),
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
) STRICT;

CREATE INDEX idx_article_tags_tag ON article_tags(tag_id);

CREATE TABLE annotations (
  id INTEGER PRIMARY KEY,
  article_id INTEGER NOT NULL,
  quote TEXT NOT NULL,
  ranges_json TEXT NOT NULL,
  text TEXT,
  created_at TEXT,
  updated_at TEXT,
  pending_op TEXT,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
) STRICT;

CREATE INDEX idx_annotations_article ON annotations(article_id);

CREATE TABLE outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  op TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error TEXT
) STRICT;

CREATE INDEX idx_outbox_next ON outbox(next_attempt_at);

CREATE TABLE sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;
