-- 002_fts: FTS5 virtual table over articles.title + content + url, kept in
-- sync with the canonical `articles` table via INSERT/UPDATE/DELETE triggers.

CREATE VIRTUAL TABLE articles_fts USING fts5(
  title,
  content,
  url,
  content='articles',
  content_rowid='id'
);

-- Backfill any existing rows.
INSERT INTO articles_fts (rowid, title, content, url)
SELECT id, COALESCE(title, ''), COALESCE(content, ''), url FROM articles;

CREATE TRIGGER articles_ai AFTER INSERT ON articles BEGIN
  INSERT INTO articles_fts (rowid, title, content, url)
  VALUES (new.id, COALESCE(new.title, ''), COALESCE(new.content, ''), new.url);
END;

CREATE TRIGGER articles_ad AFTER DELETE ON articles BEGIN
  INSERT INTO articles_fts (articles_fts, rowid, title, content, url)
  VALUES ('delete', old.id, COALESCE(old.title, ''), COALESCE(old.content, ''), old.url);
END;

CREATE TRIGGER articles_au AFTER UPDATE ON articles BEGIN
  INSERT INTO articles_fts (articles_fts, rowid, title, content, url)
  VALUES ('delete', old.id, COALESCE(old.title, ''), COALESCE(old.content, ''), old.url);
  INSERT INTO articles_fts (rowid, title, content, url)
  VALUES (new.id, COALESCE(new.title, ''), COALESCE(new.content, ''), new.url);
END;
