-- 003_images: per-article image cache rows. The actual file blobs live in
-- expo-file-system on native; this table tracks src ↔ local_path mappings,
-- download status, and bookkeeping for LRU eviction.

CREATE TABLE images (
  article_id INTEGER NOT NULL,
  src TEXT NOT NULL,
  local_path TEXT,
  status TEXT NOT NULL,
  size_bytes INTEGER,
  cached_at TEXT,
  PRIMARY KEY (article_id, src),
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
) STRICT;

CREATE INDEX idx_images_status ON images(status);
CREATE INDEX idx_images_cached_at ON images(cached_at);
