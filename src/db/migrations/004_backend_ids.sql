-- 004_backend_ids: introduce backend_id columns so the same local row can
-- map to different external identity formats (Wallabag integers, Readeck
-- short-uids). Local PKs stay INTEGER — FTS5 still uses articles.id as
-- content_rowid, and existing foreign keys continue to point at the local
-- PK.
--
-- For existing rows we backfill from the integer id (every Wallabag id
-- round-trips cleanly through CAST). New rows from a sync write the
-- backend's identity string directly into backend_id.

ALTER TABLE articles    ADD COLUMN backend_id TEXT;
ALTER TABLE tags        ADD COLUMN backend_id TEXT;
ALTER TABLE annotations ADD COLUMN backend_id TEXT;

UPDATE articles    SET backend_id = CAST(id AS TEXT) WHERE backend_id IS NULL;
UPDATE tags        SET backend_id = CAST(id AS TEXT) WHERE backend_id IS NULL;
UPDATE annotations SET backend_id = CAST(id AS TEXT) WHERE backend_id IS NULL;

-- SQLite treats NULLs as distinct in UNIQUE indexes, so this constraint
-- only enforces uniqueness among rows that have a backend_id set.
CREATE UNIQUE INDEX idx_articles_backend_id    ON articles(backend_id);
CREATE UNIQUE INDEX idx_tags_backend_id        ON tags(backend_id);
CREATE UNIQUE INDEX idx_annotations_backend_id ON annotations(backend_id);
