# Data Layer Implementation Plan (Phase 2 of 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a fully-tested SQLite-backed data layer with sync engine + outbox + TanStack Query hooks, so Phase 3 (Library UI) can read articles/tags/annotations and dispatch optimistic mutations against a Wallabag server with offline support.

**Architecture:** SQLite is the single source of truth for the UI. The sync engine pulls from Wallabag (`GET /api/entries.json` etc.) into SQLite; mutations write SQLite optimistically and enqueue to an outbox that drains to the API with backoff. UI reads via repo functions wrapped in TanStack Query hooks; repo writes emit events that invalidate query keys. The driver layer is abstracted so production uses `expo-sqlite` while tests use `better-sqlite3` in-memory.

**Tech Stack:** Expo SQLite (production), better-sqlite3 (tests), TanStack Query, msw for API tests, Vitest. No new app-level deps beyond expo-sqlite + better-sqlite3.

**Reference spec:** `docs/superpowers/specs/2026-05-06-wallabag-expo-client-design.md` §6 (data layer), §3 (repo layout).

**Phase 2 explicitly defers:**
- FTS5 search → Phase 3 (when search UI lands).
- Image cache (image rewriting + LRU eviction) → Phase 4 (reader needs it).
- Background sync while app fully closed → out of scope for MVP per spec §15.

**Phase 1 carry-overs respected by this plan:**
- All API calls go through `authedRequest` from `src/api/client.ts`.
- Web/native split via `Platform.OS` follows the pattern set in `src/auth/storage.ts` (Phase 1 fix).
- Test infra patches in `src/test/setup.ts` are extended only when necessary.

---

## File map for this plan

```
src/
├── api/
│   ├── entries.ts                       # GET/POST/PATCH/DELETE /api/entries
│   ├── tags.ts                          # GET /api/tags
│   ├── annotations.ts                   # GET/POST/PATCH/DELETE /api/annotations
│   └── types.ts                         # extended with Entry, Tag, Annotation, EntriesPage
├── db/
│   ├── driver.ts                        # DbDriver interface
│   ├── driver-expo.ts                   # production: expo-sqlite
│   ├── driver-better-sqlite3.ts         # tests: better-sqlite3 in-memory
│   ├── index.ts                         # getDb() lifecycle (open + run migrations)
│   ├── migrations/
│   │   ├── 001_initial.sql              # schema (no FTS yet)
│   │   └── index.ts                     # migration runner
│   └── repos/
│       ├── articles.ts
│       ├── tags.ts
│       ├── annotations.ts
│       ├── outbox.ts
│       └── sync-state.ts
├── sync/
│   ├── engine.ts                        # runInitialSync, runIncrementalSync
│   ├── outbox-drainer.ts                # drain + backoff
│   ├── conflict.ts                      # last-write-wins resolution
│   └── events.ts                        # repo-write event bus
└── hooks/
    ├── useArticles.ts
    ├── useArticle.ts
    ├── useTags.ts
    ├── useAnnotations.ts
    ├── useSyncStatus.ts
    └── useSyncNow.ts

tests/
├── unit/
│   ├── db-driver.test.ts
│   ├── migrations.test.ts
│   ├── api-entries.test.ts
│   ├── api-tags.test.ts
│   ├── api-annotations.test.ts
│   ├── repo-articles.test.ts
│   ├── repo-tags.test.ts
│   ├── repo-annotations.test.ts
│   ├── repo-outbox.test.ts
│   ├── repo-sync-state.test.ts
│   ├── sync-initial.test.ts
│   ├── sync-incremental.test.ts
│   ├── outbox-drainer.test.ts
│   └── events.test.ts
└── ui/
    └── (phase 3, no UI tests this phase)
```

20 tasks total. No UI work this phase — every task lands behind-the-scenes infrastructure with unit tests.

---

## Task 1: SQLite driver abstraction

The driver interface lets production use `expo-sqlite` while tests use `better-sqlite3`. This is the load-bearing decision of the data layer — get it right once, never think about it again.

**Files:**
- Create: `src/db/driver.ts`, `src/db/driver-better-sqlite3.ts`, `tests/unit/db-driver.test.ts`

- [ ] **Step 1: Install better-sqlite3 (dev) and expo-sqlite (prod)**

```bash
pnpm add expo-sqlite@latest
pnpm add -D better-sqlite3@latest @types/better-sqlite3@latest
```

- [ ] **Step 2: Write a failing test for the driver contract**

`tests/unit/db-driver.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createBetterSqliteDriver } from "@/db/driver-better-sqlite3";
import type { DbDriver } from "@/db/driver";

let db: DbDriver;

beforeEach(async () => {
  db = await createBetterSqliteDriver(":memory:");
  await db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
});

describe("DbDriver", () => {
  it("runs and returns rowid + changes", async () => {
    const r = await db.run("INSERT INTO t (name) VALUES (?)", ["a"]);
    expect(r.changes).toBe(1);
    expect(Number(r.lastId)).toBeGreaterThan(0);
  });

  it("get returns first row or null", async () => {
    expect(await db.get<{ id: number }>("SELECT id FROM t WHERE name = ?", ["x"])).toBeNull();
    await db.run("INSERT INTO t (name) VALUES (?)", ["x"]);
    const row = await db.get<{ id: number; name: string }>(
      "SELECT id, name FROM t WHERE name = ?",
      ["x"],
    );
    expect(row?.name).toBe("x");
  });

  it("all returns array", async () => {
    await db.run("INSERT INTO t (name) VALUES (?), (?)", ["a", "b"]);
    const rows = await db.all<{ name: string }>("SELECT name FROM t ORDER BY id");
    expect(rows.map((r) => r.name)).toEqual(["a", "b"]);
  });

  it("transaction commits on success", async () => {
    await db.transaction(async (tx) => {
      await tx.run("INSERT INTO t (name) VALUES (?)", ["c"]);
      await tx.run("INSERT INTO t (name) VALUES (?)", ["d"]);
    });
    const rows = await db.all<{ name: string }>("SELECT name FROM t ORDER BY id");
    expect(rows.map((r) => r.name)).toEqual(["c", "d"]);
  });

  it("transaction rolls back on throw", async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.run("INSERT INTO t (name) VALUES (?)", ["c"]);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const rows = await db.all<{ name: string }>("SELECT name FROM t");
    expect(rows.length).toBe(0);
  });
});
```

- [ ] **Step 3: Run** `pnpm test tests/unit/db-driver.test.ts` — expect FAIL.

- [ ] **Step 4: Implement `src/db/driver.ts`**

```ts
export type RunResult = { changes: number; lastId: number | bigint };

export interface DbDriver {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: readonly unknown[]): Promise<RunResult>;
  get<T>(sql: string, params?: readonly unknown[]): Promise<T | null>;
  all<T>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  transaction<T>(fn: (tx: DbDriver) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
```

- [ ] **Step 5: Implement `src/db/driver-better-sqlite3.ts`**

```ts
import Database from "better-sqlite3";
import type { DbDriver, RunResult } from "./driver";

class BetterSqliteDriver implements DbDriver {
  constructor(private readonly db: Database.Database) {}

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async run(sql: string, params: readonly unknown[] = []): Promise<RunResult> {
    const stmt = this.db.prepare(sql);
    const r = stmt.run(...(params as unknown[]));
    return { changes: r.changes, lastId: r.lastInsertRowid };
  }

  async get<T>(sql: string, params: readonly unknown[] = []): Promise<T | null> {
    const stmt = this.db.prepare(sql);
    return (stmt.get(...(params as unknown[])) as T | undefined) ?? null;
  }

  async all<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    return stmt.all(...(params as unknown[])) as T[];
  }

  async transaction<T>(fn: (tx: DbDriver) => Promise<T>): Promise<T> {
    // better-sqlite3 transactions are sync; run async fn outside, then commit/rollback.
    this.db.exec("BEGIN");
    try {
      const result = await fn(this);
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

export async function createBetterSqliteDriver(filename: string): Promise<DbDriver> {
  const db = new Database(filename);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return new BetterSqliteDriver(db);
}
```

- [ ] **Step 6: Run tests — expect 5 passed.**

- [ ] **Step 7: Commit**

```
feat(db): SQLite driver abstraction with better-sqlite3 test impl
```

---

## Task 2: Expo SQLite production driver

**Files:**
- Create: `src/db/driver-expo.ts`, `src/db/index.ts`

This driver is only exercised at runtime on device/web; we don't unit-test it (would require mocking `expo-sqlite`'s native module). Tests against the driver INTERFACE come via Task 1's better-sqlite3 impl.

- [ ] **Step 1: Implement `src/db/driver-expo.ts`**

```ts
import * as SQLite from "expo-sqlite";
import type { DbDriver, RunResult } from "./driver";

class ExpoSqliteDriver implements DbDriver {
  constructor(private readonly db: SQLite.SQLiteDatabase) {}

  async exec(sql: string): Promise<void> {
    await this.db.execAsync(sql);
  }

  async run(sql: string, params: readonly unknown[] = []): Promise<RunResult> {
    const r = await this.db.runAsync(sql, params as SQLite.SQLiteBindValue[]);
    return { changes: r.changes, lastId: r.lastInsertRowId };
  }

  async get<T>(sql: string, params: readonly unknown[] = []): Promise<T | null> {
    const row = await this.db.getFirstAsync<T>(sql, params as SQLite.SQLiteBindValue[]);
    return row ?? null;
  }

  async all<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    return this.db.getAllAsync<T>(sql, params as SQLite.SQLiteBindValue[]);
  }

  async transaction<T>(fn: (tx: DbDriver) => Promise<T>): Promise<T> {
    let result: T;
    await this.db.withTransactionAsync(async () => {
      result = await fn(this);
    });
    return result!;
  }

  async close(): Promise<void> {
    await this.db.closeAsync();
  }
}

export async function createExpoSqliteDriver(name: string): Promise<DbDriver> {
  const db = await SQLite.openDatabaseAsync(name, { useNewConnection: false });
  await db.execAsync("PRAGMA journal_mode = WAL");
  await db.execAsync("PRAGMA foreign_keys = ON");
  return new ExpoSqliteDriver(db);
}
```

- [ ] **Step 2: Implement `src/db/index.ts` (lifecycle wrapper)**

```ts
import { Platform } from "react-native";
import type { DbDriver } from "./driver";
import { runMigrations } from "./migrations";

let cached: Promise<DbDriver> | null = null;

async function makeDriver(): Promise<DbDriver> {
  if (Platform.OS === "web") {
    // Web-target driver. expo-sqlite has a wasm-backed web impl as of SDK 52+.
    // If it crashes for the same reason expo-secure-store did, switch to a
    // direct sql.js wrapper here. We'll cross that bridge when we hit it.
    const { createExpoSqliteDriver } = await import("./driver-expo");
    return createExpoSqliteDriver("wallabag.db");
  }
  const { createExpoSqliteDriver } = await import("./driver-expo");
  return createExpoSqliteDriver("wallabag.db");
}

export async function getDb(): Promise<DbDriver> {
  if (!cached) {
    cached = (async () => {
      const driver = await makeDriver();
      await runMigrations(driver);
      return driver;
    })();
  }
  return cached;
}

// For sign-out / tests
export async function resetDb(): Promise<void> {
  if (cached) {
    const d = await cached;
    await d.close();
    cached = null;
  }
}

// For tests: inject a driver directly so we don't go through `makeDriver`.
export function setDbForTesting(driver: DbDriver | null): void {
  cached = driver ? Promise.resolve(driver) : null;
}
```

- [ ] **Step 3: Verify typecheck and lint pass**

`pnpm typecheck && pnpm lint`

- [ ] **Step 4: Commit**

```
feat(db): expo-sqlite production driver + getDb() lifecycle
```

---

## Task 3: Initial schema migration

**Files:**
- Create: `src/db/migrations/001_initial.sql`, `src/db/migrations/index.ts`, `tests/unit/migrations.test.ts`

- [ ] **Step 1: Write the schema** at `src/db/migrations/001_initial.sql`:

```sql
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

CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
) STRICT;
```

- [ ] **Step 2: Failing test for migrations** at `tests/unit/migrations.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createBetterSqliteDriver } from "@/db/driver-better-sqlite3";
import { runMigrations } from "@/db/migrations";
import type { DbDriver } from "@/db/driver";

let db: DbDriver;

beforeEach(async () => {
  db = await createBetterSqliteDriver(":memory:");
});

describe("runMigrations", () => {
  it("creates all expected tables on first run", async () => {
    await runMigrations(db);
    const tables = await db.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    );
    const names = tables.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "articles",
        "tags",
        "article_tags",
        "annotations",
        "outbox",
        "sync_state",
        "schema_migrations",
      ]),
    );
  });

  it("records applied versions", async () => {
    await runMigrations(db);
    const rows = await db.all<{ version: number }>(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    expect(rows.map((r) => r.version)).toEqual([1]);
  });

  it("is idempotent on repeat runs", async () => {
    await runMigrations(db);
    await runMigrations(db);
    const rows = await db.all<{ version: number }>(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    expect(rows.map((r) => r.version)).toEqual([1]);
  });
});
```

- [ ] **Step 3: Run** — expect FAIL.

- [ ] **Step 4: Implement `src/db/migrations/index.ts`**

```ts
import type { DbDriver } from "../driver";
// Static import so bundlers can pick it up; on web/native we can't fs-read at runtime.
// Plain string - keep migrations small enough to inline.
import sql001 from "./001_initial.sql";

type Migration = { version: number; sql: string; name: string };

const MIGRATIONS: readonly Migration[] = [
  { version: 1, sql: sql001 as unknown as string, name: "001_initial" },
];

async function ensureRegistry(db: DbDriver): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);
}

export async function runMigrations(db: DbDriver): Promise<void> {
  await ensureRegistry(db);
  const applied = await db.all<{ version: number }>(
    "SELECT version FROM schema_migrations ORDER BY version",
  );
  const appliedSet = new Set(applied.map((a) => a.version));

  for (const m of MIGRATIONS) {
    if (appliedSet.has(m.version)) continue;
    await db.transaction(async (tx) => {
      await tx.exec(m.sql);
      await tx.run(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
        [m.version, new Date().toISOString()],
      );
    });
  }
}
```

- [ ] **Step 5: Configure SQL imports**

The `import sql001 from "./001_initial.sql"` requires a loader. Add to `vitest.config.ts` and `metro.config.js`:

For Vitest, add to `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";
import fs from "node:fs";

export default defineConfig({
  // ... existing config
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "react-native": "react-native-web",
    },
  },
  plugins: [
    {
      name: "raw-sql",
      transform(code, id) {
        if (id.endsWith(".sql")) {
          const raw = fs.readFileSync(id, "utf8");
          return { code: `export default ${JSON.stringify(raw)};`, map: null };
        }
        return null;
      },
    },
  ],
});
```

For Metro (production), add to `metro.config.js`:

```js
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);
// Treat .sql files as source assets.
config.resolver.sourceExts.push("sql");
// Add a custom transformer that wraps .sql in a string export.
config.transformer.babelTransformerPath = require.resolve("./scripts/sql-transformer.js");
module.exports = withNativeWind(config, { input: "./global.css" });
```

Create `scripts/sql-transformer.js`:

```js
const upstream = require("@expo/metro-config/babel-transformer");
const fs = require("node:fs");

module.exports.transform = function transform({ src, filename, options }) {
  if (filename.endsWith(".sql")) {
    const raw = fs.readFileSync(filename, "utf8");
    const wrapped = `module.exports = ${JSON.stringify(raw)};`;
    return upstream.transform({ src: wrapped, filename, options });
  }
  return upstream.transform({ src, filename, options });
};
```

Add a TypeScript ambient declaration so `import sql from "./*.sql"` typechecks. Create `sql.d.ts` at the repo root:

```ts
declare module "*.sql" {
  const content: string;
  export default content;
}
```

Add `sql.d.ts` to `tsconfig.json`'s `include` array.

- [ ] **Step 6: Run tests — expect 3 passed.**

- [ ] **Step 7: Commit**

```
feat(db): initial schema migration + migration runner with version tracking
```

---

## Task 4: Tags repo

Smallest repo, lands first to validate the repo pattern.

**Files:**
- Create: `src/db/repos/tags.ts`, `tests/unit/repo-tags.test.ts`

- [ ] **Step 1: Failing test** at `tests/unit/repo-tags.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createBetterSqliteDriver } from "@/db/driver-better-sqlite3";
import { runMigrations } from "@/db/migrations";
import type { DbDriver } from "@/db/driver";
import { upsertTags, listTags, attachTags, tagsForArticle } from "@/db/repos/tags";

let db: DbDriver;

beforeEach(async () => {
  db = await createBetterSqliteDriver(":memory:");
  await runMigrations(db);
  // articles row required for FK on article_tags
  await db.run(
    `INSERT INTO articles (id, url) VALUES (?, ?)`,
    [1, "https://example.com/a"],
  );
});

describe("tags repo", () => {
  it("upserts tags and lists them sorted", async () => {
    await upsertTags(db, [
      { id: 10, label: "Foo", slug: "foo" },
      { id: 11, label: "Bar", slug: "bar" },
    ]);
    const all = await listTags(db);
    expect(all.map((t) => t.slug)).toEqual(["bar", "foo"]);
  });

  it("upsert is idempotent and updates label", async () => {
    await upsertTags(db, [{ id: 10, label: "Old", slug: "foo" }]);
    await upsertTags(db, [{ id: 10, label: "New", slug: "foo" }]);
    const all = await listTags(db);
    expect(all).toEqual([{ id: 10, label: "New", slug: "foo" }]);
  });

  it("attachTags links and tagsForArticle returns them", async () => {
    await upsertTags(db, [
      { id: 10, label: "Foo", slug: "foo" },
      { id: 11, label: "Bar", slug: "bar" },
    ]);
    await attachTags(db, 1, [10, 11]);
    const t = await tagsForArticle(db, 1);
    expect(t.map((x) => x.slug).sort()).toEqual(["bar", "foo"]);
  });

  it("attachTags replaces previous links", async () => {
    await upsertTags(db, [
      { id: 10, label: "Foo", slug: "foo" },
      { id: 11, label: "Bar", slug: "bar" },
    ]);
    await attachTags(db, 1, [10, 11]);
    await attachTags(db, 1, [10]);
    const t = await tagsForArticle(db, 1);
    expect(t.map((x) => x.slug)).toEqual(["foo"]);
  });
});
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Implement `src/db/repos/tags.ts`**

```ts
import type { DbDriver } from "../driver";

export type Tag = { id: number; label: string; slug: string };

export async function upsertTags(db: DbDriver, tags: readonly Tag[]): Promise<void> {
  if (tags.length === 0) return;
  await db.transaction(async (tx) => {
    for (const t of tags) {
      await tx.run(
        `INSERT INTO tags (id, label, slug) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET label = excluded.label, slug = excluded.slug`,
        [t.id, t.label, t.slug],
      );
    }
  });
}

export async function listTags(db: DbDriver): Promise<Tag[]> {
  return db.all<Tag>("SELECT id, label, slug FROM tags ORDER BY slug");
}

export async function attachTags(
  db: DbDriver,
  articleId: number,
  tagIds: readonly number[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.run("DELETE FROM article_tags WHERE article_id = ?", [articleId]);
    for (const tagId of tagIds) {
      await tx.run(
        "INSERT INTO article_tags (article_id, tag_id) VALUES (?, ?)",
        [articleId, tagId],
      );
    }
  });
}

export async function tagsForArticle(db: DbDriver, articleId: number): Promise<Tag[]> {
  return db.all<Tag>(
    `SELECT t.id, t.label, t.slug
     FROM tags t
     JOIN article_tags at ON at.tag_id = t.id
     WHERE at.article_id = ?
     ORDER BY t.slug`,
    [articleId],
  );
}
```

- [ ] **Step 4: Run tests — expect 4 passed.**

- [ ] **Step 5: Commit**

```
feat(db): tags repo (upsert, list, attach, tagsForArticle)
```

---

## Task 5: Articles repo

**Files:**
- Create: `src/db/repos/articles.ts`, `tests/unit/repo-articles.test.ts`

- [ ] **Step 1: Failing test** at `tests/unit/repo-articles.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createBetterSqliteDriver } from "@/db/driver-better-sqlite3";
import { runMigrations } from "@/db/migrations";
import type { DbDriver } from "@/db/driver";
import {
  upsertArticles,
  getArticle,
  listArticles,
  setArchived,
  setStarred,
  setScrollPosition,
} from "@/db/repos/articles";

let db: DbDriver;

beforeEach(async () => {
  db = await createBetterSqliteDriver(":memory:");
  await runMigrations(db);
});

const sample = (over: Partial<{ id: number; title: string; is_starred: number; is_archived: number; updated_at: string }> = {}) => ({
  id: 1,
  title: "Hello",
  url: "https://example.com/a",
  domain_name: "example.com",
  content: "<p>hi</p>",
  preview_picture: null,
  reading_time: 2,
  language: "en",
  is_archived: 0,
  is_starred: 0,
  created_at: "2026-05-01T00:00:00Z",
  updated_at: "2026-05-02T00:00:00Z",
  starred_at: null,
  archived_at: null,
  published_at: "2026-04-30T00:00:00Z",
  published_by: "alice",
  ...over,
});

describe("articles repo", () => {
  it("upsert + getArticle round-trips", async () => {
    await upsertArticles(db, [sample()]);
    const a = await getArticle(db, 1);
    expect(a?.title).toBe("Hello");
    expect(a?.is_archived).toBe(0);
  });

  it("upsert is idempotent and updates fields", async () => {
    await upsertArticles(db, [sample({ title: "Old" })]);
    await upsertArticles(db, [sample({ title: "New" })]);
    const a = await getArticle(db, 1);
    expect(a?.title).toBe("New");
  });

  it("listArticles filters by unread / starred / archive / all", async () => {
    await upsertArticles(db, [
      sample({ id: 1, is_archived: 0, is_starred: 0, updated_at: "2026-05-04T00:00:00Z" }),
      sample({ id: 2, is_archived: 1, is_starred: 0, updated_at: "2026-05-03T00:00:00Z" }),
      sample({ id: 3, is_archived: 0, is_starred: 1, updated_at: "2026-05-02T00:00:00Z" }),
    ]);
    expect((await listArticles(db, { filter: "unread" })).map((a) => a.id)).toEqual([3, 1]);
    expect((await listArticles(db, { filter: "archive" })).map((a) => a.id)).toEqual([2]);
    expect((await listArticles(db, { filter: "starred" })).map((a) => a.id)).toEqual([3]);
    expect((await listArticles(db, { filter: "all" })).map((a) => a.id)).toEqual([1, 2, 3]);
  });

  it("setArchived / setStarred toggle and bump local_updated_at + pending_op", async () => {
    await upsertArticles(db, [sample()]);
    await setArchived(db, 1, true);
    const a = await getArticle(db, 1);
    expect(a?.is_archived).toBe(1);
    expect(a?.pending_op).toBe("update");
    expect(a?.archived_at).toBeTruthy();
    expect(a?.local_updated_at).toBeTruthy();

    await setStarred(db, 1, true);
    const b = await getArticle(db, 1);
    expect(b?.is_starred).toBe(1);
    expect(b?.starred_at).toBeTruthy();
  });

  it("setScrollPosition stores 0..1", async () => {
    await upsertArticles(db, [sample()]);
    await setScrollPosition(db, 1, 0.42);
    const a = await getArticle(db, 1);
    expect(a?.scroll_position).toBeCloseTo(0.42, 4);
  });
});
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Implement `src/db/repos/articles.ts`**

```ts
import type { DbDriver } from "../driver";

export type Filter = "unread" | "starred" | "archive" | "all";

export type ArticleRow = {
  id: number;
  title: string | null;
  url: string;
  domain_name: string | null;
  content: string | null;
  preview_picture: string | null;
  reading_time: number | null;
  language: string | null;
  is_archived: number;
  is_starred: number;
  created_at: string | null;
  updated_at: string | null;
  starred_at: string | null;
  archived_at: string | null;
  published_at: string | null;
  published_by: string | null;
  scroll_position: number;
  server_updated_at: string | null;
  local_updated_at: string | null;
  pending_op: string | null;
};

const COLS = [
  "id",
  "title",
  "url",
  "domain_name",
  "content",
  "preview_picture",
  "reading_time",
  "language",
  "is_archived",
  "is_starred",
  "created_at",
  "updated_at",
  "starred_at",
  "archived_at",
  "published_at",
  "published_by",
  "scroll_position",
  "server_updated_at",
  "local_updated_at",
  "pending_op",
] as const;

export async function upsertArticles(
  db: DbDriver,
  articles: readonly Partial<ArticleRow>[],
): Promise<void> {
  if (articles.length === 0) return;
  await db.transaction(async (tx) => {
    for (const a of articles) {
      const cols = COLS.filter((c) => a[c] !== undefined);
      const placeholders = cols.map(() => "?").join(", ");
      const updateSet = cols.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`).join(", ");
      const sql = `INSERT INTO articles (${cols.join(", ")}) VALUES (${placeholders})
                   ON CONFLICT(id) DO UPDATE SET ${updateSet}`;
      await tx.run(sql, cols.map((c) => a[c] as unknown));
    }
  });
}

export async function getArticle(db: DbDriver, id: number): Promise<ArticleRow | null> {
  return db.get<ArticleRow>(`SELECT ${COLS.join(", ")} FROM articles WHERE id = ?`, [id]);
}

export async function listArticles(
  db: DbDriver,
  args: { filter: Filter; limit?: number; offset?: number },
): Promise<ArticleRow[]> {
  const where =
    args.filter === "unread"
      ? "WHERE is_archived = 0"
      : args.filter === "starred"
        ? "WHERE is_starred = 1"
        : args.filter === "archive"
          ? "WHERE is_archived = 1"
          : "";
  const limit = args.limit ?? 200;
  const offset = args.offset ?? 0;
  return db.all<ArticleRow>(
    `SELECT ${COLS.join(", ")} FROM articles ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
    [limit, offset],
  );
}

export async function setArchived(db: DbDriver, id: number, archived: boolean): Promise<void> {
  const now = new Date().toISOString();
  await db.run(
    `UPDATE articles SET is_archived = ?, archived_at = ?, local_updated_at = ?, pending_op = 'update' WHERE id = ?`,
    [archived ? 1 : 0, archived ? now : null, now, id],
  );
}

export async function setStarred(db: DbDriver, id: number, starred: boolean): Promise<void> {
  const now = new Date().toISOString();
  await db.run(
    `UPDATE articles SET is_starred = ?, starred_at = ?, local_updated_at = ?, pending_op = 'update' WHERE id = ?`,
    [starred ? 1 : 0, starred ? now : null, now, id],
  );
}

export async function setScrollPosition(
  db: DbDriver,
  id: number,
  position: number,
): Promise<void> {
  await db.run(`UPDATE articles SET scroll_position = ? WHERE id = ?`, [position, id]);
}

export async function deleteArticle(db: DbDriver, id: number): Promise<void> {
  await db.run("DELETE FROM articles WHERE id = ?", [id]);
}

export async function clearPendingOp(db: DbDriver, id: number): Promise<void> {
  await db.run(
    "UPDATE articles SET pending_op = NULL, server_updated_at = local_updated_at WHERE id = ?",
    [id],
  );
}
```

- [ ] **Step 4: Run — expect 5 passed.**

- [ ] **Step 5: Commit**

```
feat(db): articles repo (upsert, get, list with filter, mutations)
```

---

## Task 6: Annotations repo

**Files:**
- Create: `src/db/repos/annotations.ts`, `tests/unit/repo-annotations.test.ts`

- [ ] **Step 1: Failing test** at `tests/unit/repo-annotations.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createBetterSqliteDriver } from "@/db/driver-better-sqlite3";
import { runMigrations } from "@/db/migrations";
import type { DbDriver } from "@/db/driver";
import {
  upsertAnnotations,
  listAnnotations,
  createAnnotation,
  deleteAnnotation,
} from "@/db/repos/annotations";

let db: DbDriver;

beforeEach(async () => {
  db = await createBetterSqliteDriver(":memory:");
  await runMigrations(db);
  await db.run("INSERT INTO articles (id, url) VALUES (?, ?)", [1, "https://example.com/a"]);
});

describe("annotations repo", () => {
  it("upserts and lists by article", async () => {
    await upsertAnnotations(db, [
      {
        id: 10,
        article_id: 1,
        quote: "hello",
        ranges_json: "[]",
        text: "note 1",
        created_at: "2026-05-01T00:00:00Z",
        updated_at: "2026-05-01T00:00:00Z",
      },
    ]);
    const list = await listAnnotations(db, 1);
    expect(list.map((a) => a.quote)).toEqual(["hello"]);
  });

  it("createAnnotation generates a temp negative id and pending_op = create", async () => {
    const id = await createAnnotation(db, {
      article_id: 1,
      quote: "fresh",
      ranges_json: "[]",
      text: null,
    });
    expect(id).toBeLessThan(0);
    const list = await listAnnotations(db, 1);
    expect(list[0]?.pending_op).toBe("create");
  });

  it("deleteAnnotation marks for delete (does not row-remove until drained)", async () => {
    await upsertAnnotations(db, [
      {
        id: 10,
        article_id: 1,
        quote: "x",
        ranges_json: "[]",
        text: null,
        created_at: "2026-05-01T00:00:00Z",
        updated_at: "2026-05-01T00:00:00Z",
      },
    ]);
    await deleteAnnotation(db, 10);
    const row = (await listAnnotations(db, 1))[0];
    expect(row?.pending_op).toBe("delete");
  });
});
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Implement `src/db/repos/annotations.ts`**

```ts
import type { DbDriver } from "../driver";

export type AnnotationRow = {
  id: number;
  article_id: number;
  quote: string;
  ranges_json: string;
  text: string | null;
  created_at: string | null;
  updated_at: string | null;
  pending_op: string | null;
};

const COLS = [
  "id",
  "article_id",
  "quote",
  "ranges_json",
  "text",
  "created_at",
  "updated_at",
  "pending_op",
] as const;

let nextTempId = -1;

export async function upsertAnnotations(
  db: DbDriver,
  rows: readonly Partial<AnnotationRow>[],
): Promise<void> {
  if (rows.length === 0) return;
  await db.transaction(async (tx) => {
    for (const a of rows) {
      const cols = COLS.filter((c) => a[c] !== undefined);
      const placeholders = cols.map(() => "?").join(", ");
      const updateSet = cols.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`).join(", ");
      const sql = `INSERT INTO annotations (${cols.join(", ")}) VALUES (${placeholders})
                   ON CONFLICT(id) DO UPDATE SET ${updateSet}`;
      await tx.run(sql, cols.map((c) => a[c] as unknown));
    }
  });
}

export async function listAnnotations(
  db: DbDriver,
  articleId: number,
): Promise<AnnotationRow[]> {
  return db.all<AnnotationRow>(
    `SELECT ${COLS.join(", ")} FROM annotations
     WHERE article_id = ? AND (pending_op IS NULL OR pending_op != 'delete')
     ORDER BY id`,
    [articleId],
  );
}

export async function createAnnotation(
  db: DbDriver,
  payload: { article_id: number; quote: string; ranges_json: string; text: string | null },
): Promise<number> {
  const id = nextTempId--;
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO annotations (id, article_id, quote, ranges_json, text, created_at, updated_at, pending_op)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'create')`,
    [id, payload.article_id, payload.quote, payload.ranges_json, payload.text, now, now],
  );
  return id;
}

export async function deleteAnnotation(db: DbDriver, id: number): Promise<void> {
  await db.run(`UPDATE annotations SET pending_op = 'delete' WHERE id = ?`, [id]);
}

export async function rewriteAnnotationId(
  db: DbDriver,
  tempId: number,
  realId: number,
): Promise<void> {
  await db.run(
    `UPDATE annotations SET id = ?, pending_op = NULL WHERE id = ?`,
    [realId, tempId],
  );
}

export async function purgeDeleted(db: DbDriver, id: number): Promise<void> {
  await db.run(`DELETE FROM annotations WHERE id = ? AND pending_op = 'delete'`, [id]);
}
```

- [ ] **Step 4: Run — expect 3 passed.**

- [ ] **Step 5: Commit**

```
feat(db): annotations repo with temp-id support for offline creates
```

---

## Task 7: Outbox repo

**Files:**
- Create: `src/db/repos/outbox.ts`, `tests/unit/repo-outbox.test.ts`

- [ ] **Step 1: Failing test** at `tests/unit/repo-outbox.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { createBetterSqliteDriver } from "@/db/driver-better-sqlite3";
import { runMigrations } from "@/db/migrations";
import type { DbDriver } from "@/db/driver";
import {
  enqueue,
  peekDue,
  markFailure,
  markSuccess,
  type OutboxOp,
} from "@/db/repos/outbox";

let db: DbDriver;

beforeEach(async () => {
  db = await createBetterSqliteDriver(":memory:");
  await runMigrations(db);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("outbox repo", () => {
  it("enqueue stores op + payload", async () => {
    await enqueue(db, "updateEntry", { id: 5, is_starred: true });
    const due = await peekDue(db, 10);
    expect(due).toHaveLength(1);
    expect(due[0]?.op).toBe<OutboxOp>("updateEntry");
    expect(JSON.parse(due[0]!.payload_json)).toEqual({ id: 5, is_starred: true });
  });

  it("markFailure increments attempts and pushes next_attempt_at out", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-06T12:00:00Z"));
    await enqueue(db, "updateEntry", { id: 5 });
    const [row] = await peekDue(db, 10);
    await markFailure(db, row!.id, "boom");
    const next = await db.get<{ attempts: number; next_attempt_at: string; last_error: string }>(
      "SELECT attempts, next_attempt_at, last_error FROM outbox WHERE id = ?",
      [row!.id],
    );
    expect(next?.attempts).toBe(1);
    expect(next?.last_error).toBe("boom");
    expect(new Date(next!.next_attempt_at).getTime()).toBeGreaterThan(
      new Date("2026-05-06T12:00:00Z").getTime(),
    );
  });

  it("peekDue ignores rows with future next_attempt_at", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-06T12:00:00Z"));
    await enqueue(db, "updateEntry", { id: 5 });
    const [row] = await peekDue(db, 10);
    await markFailure(db, row!.id, "boom");
    expect(await peekDue(db, 10)).toEqual([]);
    vi.setSystemTime(new Date("2026-05-06T13:00:00Z"));
    expect((await peekDue(db, 10)).length).toBe(1);
  });

  it("markSuccess removes the row", async () => {
    await enqueue(db, "updateEntry", { id: 5 });
    const [row] = await peekDue(db, 10);
    await markSuccess(db, row!.id);
    expect(await peekDue(db, 10)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Implement `src/db/repos/outbox.ts`**

```ts
import type { DbDriver } from "../driver";

export type OutboxOp =
  | "createEntry"
  | "updateEntry"
  | "deleteEntry"
  | "addTag"
  | "removeTag"
  | "createAnnotation"
  | "updateAnnotation"
  | "deleteAnnotation";

export type OutboxRow = {
  id: number;
  op: OutboxOp;
  payload_json: string;
  created_at: string;
  attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
};

const MAX_BACKOFF_SECONDS = 600; // 10 minutes

function backoffSeconds(attempts: number): number {
  // 1, 2, 4, 8, 16, ... capped
  return Math.min(MAX_BACKOFF_SECONDS, 2 ** Math.max(0, attempts - 1));
}

export async function enqueue(
  db: DbDriver,
  op: OutboxOp,
  payload: unknown,
): Promise<number> {
  const now = new Date().toISOString();
  const r = await db.run(
    `INSERT INTO outbox (op, payload_json, created_at, next_attempt_at) VALUES (?, ?, ?, ?)`,
    [op, JSON.stringify(payload), now, now],
  );
  return Number(r.lastId);
}

export async function peekDue(db: DbDriver, limit: number): Promise<OutboxRow[]> {
  const now = new Date().toISOString();
  return db.all<OutboxRow>(
    `SELECT id, op, payload_json, created_at, attempts, next_attempt_at, last_error
     FROM outbox
     WHERE next_attempt_at IS NULL OR next_attempt_at <= ?
     ORDER BY id
     LIMIT ?`,
    [now, limit],
  );
}

export async function markFailure(
  db: DbDriver,
  id: number,
  error: string,
): Promise<void> {
  const row = await db.get<{ attempts: number }>(
    "SELECT attempts FROM outbox WHERE id = ?",
    [id],
  );
  const nextAttempts = (row?.attempts ?? 0) + 1;
  const next = new Date(Date.now() + backoffSeconds(nextAttempts) * 1000).toISOString();
  await db.run(
    `UPDATE outbox SET attempts = ?, next_attempt_at = ?, last_error = ? WHERE id = ?`,
    [nextAttempts, next, error, id],
  );
}

export async function markSuccess(db: DbDriver, id: number): Promise<void> {
  await db.run("DELETE FROM outbox WHERE id = ?", [id]);
}
```

- [ ] **Step 4: Run — expect 4 passed.**

- [ ] **Step 5: Commit**

```
feat(db): outbox repo with exponential backoff scheduling
```

---

## Task 8: Sync state repo

Tiny repo for the `sync_state` key/value table.

**Files:**
- Create: `src/db/repos/sync-state.ts`, `tests/unit/repo-sync-state.test.ts`

- [ ] **Step 1: Failing test** at `tests/unit/repo-sync-state.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createBetterSqliteDriver } from "@/db/driver-better-sqlite3";
import { runMigrations } from "@/db/migrations";
import type { DbDriver } from "@/db/driver";
import { getSyncValue, setSyncValue } from "@/db/repos/sync-state";

let db: DbDriver;

beforeEach(async () => {
  db = await createBetterSqliteDriver(":memory:");
  await runMigrations(db);
});

describe("sync-state repo", () => {
  it("returns null for missing key", async () => {
    expect(await getSyncValue(db, "last_since")).toBeNull();
  });

  it("round-trips a value", async () => {
    await setSyncValue(db, "last_since", "1000");
    expect(await getSyncValue(db, "last_since")).toBe("1000");
  });

  it("overwrites existing value", async () => {
    await setSyncValue(db, "last_since", "1000");
    await setSyncValue(db, "last_since", "2000");
    expect(await getSyncValue(db, "last_since")).toBe("2000");
  });
});
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Implement `src/db/repos/sync-state.ts`**

```ts
import type { DbDriver } from "../driver";

export type SyncStateKey = "last_initial_page" | "last_since" | "last_full_sync_at";

export async function getSyncValue(
  db: DbDriver,
  key: SyncStateKey,
): Promise<string | null> {
  const row = await db.get<{ value: string }>(
    "SELECT value FROM sync_state WHERE key = ?",
    [key],
  );
  return row?.value ?? null;
}

export async function setSyncValue(
  db: DbDriver,
  key: SyncStateKey,
  value: string,
): Promise<void> {
  await db.run(
    `INSERT INTO sync_state (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}
```

- [ ] **Step 4: Run — expect 3 passed.**

- [ ] **Step 5: Commit**

```
feat(db): sync-state key/value repo
```

---

## Task 9: Wallabag entries API binding

**Files:**
- Create: `src/api/entries.ts`, `tests/unit/api-entries.test.ts`. Modify: `src/api/types.ts`.

- [ ] **Step 1: Extend `src/api/types.ts`**

Append to the existing file:

```ts
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
```

- [ ] **Step 2: Failing test** at `tests/unit/api-entries.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../src/test/msw-server";

const secure = new Map<string, string>();
const asyncMem = new Map<string, string>();
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (k: string) => secure.get(k) ?? null),
  setItemAsync: vi.fn(async (k: string, v: string) => void secure.set(k, v)),
  deleteItemAsync: vi.fn(async (k: string) => void secure.delete(k)),
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (k: string) => asyncMem.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => void asyncMem.set(k, v)),
    removeItem: vi.fn(async (k: string) => void asyncMem.delete(k)),
  },
}));

import {
  listEntries,
  getEntry,
  createEntry,
  updateEntry,
  deleteEntry,
} from "@/api/entries";
import { applyTokenBundle } from "@/auth/tokens";

beforeEach(async () => {
  secure.clear();
  asyncMem.clear();
  secure.set("wb_client_id", "cid");
  secure.set("wb_client_secret", "cs");
  asyncMem.set("wb:server_url", "https://wb.test");
  await applyTokenBundle({
    access_token: "at",
    refresh_token: "rt",
    expires_in: 3600,
    token_type: "bearer",
  });
});

describe("listEntries", () => {
  it("paginates with detail=metadata", async () => {
    server.use(
      http.get("https://wb.test/api/entries.json", ({ request }) => {
        const u = new URL(request.url);
        expect(u.searchParams.get("detail")).toBe("metadata");
        expect(u.searchParams.get("page")).toBe("1");
        expect(u.searchParams.get("perPage")).toBe("100");
        return HttpResponse.json({
          page: 1,
          pages: 1,
          limit: 100,
          total: 1,
          _embedded: {
            items: [
              {
                id: 1,
                title: "T",
                url: "https://x",
                domain_name: "x",
                content: null,
                preview_picture: null,
                reading_time: null,
                language: null,
                is_archived: 0,
                is_starred: 0,
                created_at: "2026-05-01",
                updated_at: "2026-05-02",
                starred_at: null,
                archived_at: null,
                published_at: null,
                published_by: null,
                tags: [],
              },
            ],
          },
        });
      }),
    );
    const r = await listEntries({ page: 1, perPage: 100, detail: "metadata" });
    expect(r._embedded.items[0]?.id).toBe(1);
  });

  it("forwards since= for incremental sync", async () => {
    let captured: string | null = null;
    server.use(
      http.get("https://wb.test/api/entries.json", ({ request }) => {
        captured = new URL(request.url).searchParams.get("since");
        return HttpResponse.json({
          page: 1,
          pages: 0,
          limit: 100,
          total: 0,
          _embedded: { items: [] },
        });
      }),
    );
    await listEntries({ page: 1, perPage: 100, detail: "full", since: 12345 });
    expect(captured).toBe("12345");
  });
});

describe("getEntry / createEntry / updateEntry / deleteEntry", () => {
  it("getEntry hits /api/entries/{id}.json", async () => {
    server.use(
      http.get("https://wb.test/api/entries/9.json", () =>
        HttpResponse.json({
          id: 9,
          title: "Nine",
          url: "https://x",
          domain_name: "x",
          content: "<p>hi</p>",
          preview_picture: null,
          reading_time: 1,
          language: "en",
          is_archived: 0,
          is_starred: 0,
          created_at: "2026-05-01",
          updated_at: "2026-05-02",
          starred_at: null,
          archived_at: null,
          published_at: null,
          published_by: null,
          tags: [],
        }),
      ),
    );
    const e = await getEntry(9);
    expect(e.title).toBe("Nine");
  });

  it("createEntry posts JSON {url, tags}", async () => {
    server.use(
      http.post("https://wb.test/api/entries.json", async ({ request }) => {
        const body = (await request.json()) as { url: string; tags?: string };
        expect(body.url).toBe("https://example.com/post");
        expect(body.tags).toBe("a,b");
        return HttpResponse.json({
          id: 99,
          title: null,
          url: body.url,
          domain_name: "example.com",
          content: null,
          preview_picture: null,
          reading_time: null,
          language: null,
          is_archived: 0,
          is_starred: 0,
          created_at: "2026-05-06",
          updated_at: "2026-05-06",
          starred_at: null,
          archived_at: null,
          published_at: null,
          published_by: null,
          tags: [],
        });
      }),
    );
    const r = await createEntry("https://example.com/post", ["a", "b"]);
    expect(r.id).toBe(99);
  });

  it("updateEntry PATCHes is_starred / is_archived", async () => {
    let body: unknown;
    server.use(
      http.patch("https://wb.test/api/entries/5.json", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          id: 5,
          title: "T",
          url: "https://x",
          domain_name: "x",
          content: null,
          preview_picture: null,
          reading_time: null,
          language: null,
          is_archived: 1,
          is_starred: 1,
          created_at: "2026-05-01",
          updated_at: "2026-05-02",
          starred_at: "2026-05-02",
          archived_at: "2026-05-02",
          published_at: null,
          published_by: null,
          tags: [],
        });
      }),
    );
    await updateEntry(5, { is_starred: 1, is_archived: 1 });
    expect(body).toEqual({ archive: 1, starred: 1 });
  });

  it("deleteEntry sends DELETE /api/entries/{id}.json", async () => {
    let called = false;
    server.use(
      http.delete("https://wb.test/api/entries/7.json", () => {
        called = true;
        return HttpResponse.json({ ok: true });
      }),
    );
    await deleteEntry(7);
    expect(called).toBe(true);
  });
});
```

- [ ] **Step 3: Run** — expect FAIL.

- [ ] **Step 4: Implement `src/api/entries.ts`**

```ts
import { authedRequest } from "./client";
import type { Entry, EntriesPage, EntryDetail } from "./types";

export async function listEntries(args: {
  page: number;
  perPage: number;
  detail: EntryDetail;
  since?: number;
  archive?: 0 | 1;
  starred?: 0 | 1;
  tags?: string;
}): Promise<EntriesPage> {
  const query: Record<string, string | number | undefined> = {
    page: args.page,
    perPage: args.perPage,
    detail: args.detail,
  };
  if (args.since !== undefined) query["since"] = args.since;
  if (args.archive !== undefined) query["archive"] = args.archive;
  if (args.starred !== undefined) query["starred"] = args.starred;
  if (args.tags !== undefined) query["tags"] = args.tags;
  return authedRequest<EntriesPage>({
    method: "GET",
    path: "/api/entries.json",
    query,
  });
}

export async function getEntry(id: number): Promise<Entry> {
  return authedRequest<Entry>({ method: "GET", path: `/api/entries/${id}.json` });
}

export async function createEntry(url: string, tags?: readonly string[]): Promise<Entry> {
  return authedRequest<Entry>({
    method: "POST",
    path: "/api/entries.json",
    body: { url, ...(tags && tags.length ? { tags: tags.join(",") } : {}) },
  });
}

// Wallabag's PATCH expects `archive` (not `is_archived`) and `starred` (not `is_starred`).
export async function updateEntry(
  id: number,
  patch: { is_archived?: 0 | 1; is_starred?: 0 | 1; tags?: string },
): Promise<Entry> {
  const body: Record<string, unknown> = {};
  if (patch.is_archived !== undefined) body["archive"] = patch.is_archived;
  if (patch.is_starred !== undefined) body["starred"] = patch.is_starred;
  if (patch.tags !== undefined) body["tags"] = patch.tags;
  return authedRequest<Entry>({
    method: "PATCH",
    path: `/api/entries/${id}.json`,
    body,
  });
}

export async function deleteEntry(id: number): Promise<void> {
  await authedRequest<unknown>({ method: "DELETE", path: `/api/entries/${id}.json` });
}
```

- [ ] **Step 5: Run — expect 6 passed.**

- [ ] **Step 6: Commit**

```
feat(api): entries CRUD bindings (list with since/detail, get, create, update, delete)
```

---

## Task 10: Wallabag tags API

**Files:**
- Create: `src/api/tags.ts`, `tests/unit/api-tags.test.ts`

- [ ] **Step 1: Failing test** at `tests/unit/api-tags.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../src/test/msw-server";

const secure = new Map<string, string>();
const asyncMem = new Map<string, string>();
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (k: string) => secure.get(k) ?? null),
  setItemAsync: vi.fn(async (k: string, v: string) => void secure.set(k, v)),
  deleteItemAsync: vi.fn(async (k: string) => void secure.delete(k)),
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (k: string) => asyncMem.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => void asyncMem.set(k, v)),
    removeItem: vi.fn(async (k: string) => void asyncMem.delete(k)),
  },
}));

import { listTags, addTagsToEntry, removeTagFromEntry } from "@/api/tags";
import { applyTokenBundle } from "@/auth/tokens";

beforeEach(async () => {
  secure.clear();
  asyncMem.clear();
  secure.set("wb_client_id", "cid");
  secure.set("wb_client_secret", "cs");
  asyncMem.set("wb:server_url", "https://wb.test");
  await applyTokenBundle({
    access_token: "at",
    refresh_token: "rt",
    expires_in: 3600,
    token_type: "bearer",
  });
});

describe("tags API", () => {
  it("listTags returns all", async () => {
    server.use(
      http.get("https://wb.test/api/tags.json", () =>
        HttpResponse.json([
          { id: 1, label: "foo", slug: "foo" },
          { id: 2, label: "bar", slug: "bar" },
        ]),
      ),
    );
    const t = await listTags();
    expect(t.map((x) => x.id)).toEqual([1, 2]);
  });

  it("addTagsToEntry posts comma-joined", async () => {
    let body: unknown;
    server.use(
      http.post("https://wb.test/api/entries/9/tags.json", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: 9, tags: [{ id: 1, label: "foo", slug: "foo" }] });
      }),
    );
    await addTagsToEntry(9, ["foo", "bar"]);
    expect(body).toEqual({ tags: "foo,bar" });
  });

  it("removeTagFromEntry deletes /api/entries/{id}/tags/{tagId}.json", async () => {
    let called = false;
    server.use(
      http.delete("https://wb.test/api/entries/9/tags/3.json", () => {
        called = true;
        return HttpResponse.json({ ok: true });
      }),
    );
    await removeTagFromEntry(9, 3);
    expect(called).toBe(true);
  });
});
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Implement `src/api/tags.ts`**

```ts
import { authedRequest } from "./client";
import type { EntryTag } from "./types";

export async function listTags(): Promise<EntryTag[]> {
  return authedRequest<EntryTag[]>({ method: "GET", path: "/api/tags.json" });
}

export async function addTagsToEntry(entryId: number, labels: readonly string[]): Promise<void> {
  await authedRequest<unknown>({
    method: "POST",
    path: `/api/entries/${entryId}/tags.json`,
    body: { tags: labels.join(",") },
  });
}

export async function removeTagFromEntry(entryId: number, tagId: number): Promise<void> {
  await authedRequest<unknown>({
    method: "DELETE",
    path: `/api/entries/${entryId}/tags/${tagId}.json`,
  });
}
```

- [ ] **Step 4: Run — expect 3 passed.**

- [ ] **Step 5: Commit**

```
feat(api): tags bindings (list, add to entry, remove from entry)
```

---

## Task 11: Wallabag annotations API

**Files:**
- Create: `src/api/annotations.ts`, `tests/unit/api-annotations.test.ts`

- [ ] **Step 1: Add `Annotation` type to `src/api/types.ts`**

```ts
export type Annotation = {
  id: number;
  quote: string;
  text: string | null;
  ranges: { start: string; startOffset: number; end: string; endOffset: number }[];
  created_at: string;
  updated_at: string;
};
```

- [ ] **Step 2: Failing test** at `tests/unit/api-annotations.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../src/test/msw-server";

const secure = new Map<string, string>();
const asyncMem = new Map<string, string>();
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (k: string) => secure.get(k) ?? null),
  setItemAsync: vi.fn(async (k: string, v: string) => void secure.set(k, v)),
  deleteItemAsync: vi.fn(async (k: string) => void secure.delete(k)),
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (k: string) => asyncMem.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => void asyncMem.set(k, v)),
    removeItem: vi.fn(async (k: string) => void asyncMem.delete(k)),
  },
}));

import {
  listAnnotations,
  createAnnotation,
  updateAnnotation,
  deleteAnnotation,
} from "@/api/annotations";
import { applyTokenBundle } from "@/auth/tokens";

beforeEach(async () => {
  secure.clear();
  asyncMem.clear();
  secure.set("wb_client_id", "cid");
  secure.set("wb_client_secret", "cs");
  asyncMem.set("wb:server_url", "https://wb.test");
  await applyTokenBundle({
    access_token: "at",
    refresh_token: "rt",
    expires_in: 3600,
    token_type: "bearer",
  });
});

const fakeAnnotation = {
  id: 100,
  quote: "hi",
  text: "note",
  ranges: [{ start: "/p[1]", startOffset: 0, end: "/p[1]", endOffset: 2 }],
  created_at: "2026-05-01",
  updated_at: "2026-05-01",
};

describe("annotations API", () => {
  it("listAnnotations returns rows array", async () => {
    server.use(
      http.get("https://wb.test/api/annotations/9.json", () =>
        HttpResponse.json({ total: 1, rows: [fakeAnnotation] }),
      ),
    );
    const r = await listAnnotations(9);
    expect(r[0]?.id).toBe(100);
  });

  it("createAnnotation posts ranges + quote + text", async () => {
    server.use(
      http.post("https://wb.test/api/annotations/9.json", async ({ request }) => {
        const body = (await request.json()) as { quote: string };
        expect(body.quote).toBe("hi");
        return HttpResponse.json(fakeAnnotation);
      }),
    );
    const r = await createAnnotation(9, {
      quote: "hi",
      ranges: fakeAnnotation.ranges,
      text: "note",
    });
    expect(r.id).toBe(100);
  });

  it("updateAnnotation PUTs", async () => {
    server.use(
      http.put("https://wb.test/api/annotations/100.json", () =>
        HttpResponse.json({ ...fakeAnnotation, text: "updated" }),
      ),
    );
    const r = await updateAnnotation(100, { text: "updated" });
    expect(r.text).toBe("updated");
  });

  it("deleteAnnotation DELETEs", async () => {
    let called = false;
    server.use(
      http.delete("https://wb.test/api/annotations/100.json", () => {
        called = true;
        return HttpResponse.json({ ok: true });
      }),
    );
    await deleteAnnotation(100);
    expect(called).toBe(true);
  });
});
```

- [ ] **Step 3: Run** — expect FAIL.

- [ ] **Step 4: Implement `src/api/annotations.ts`**

```ts
import { authedRequest } from "./client";
import type { Annotation } from "./types";

export async function listAnnotations(entryId: number): Promise<Annotation[]> {
  const r = await authedRequest<{ total: number; rows: Annotation[] }>({
    method: "GET",
    path: `/api/annotations/${entryId}.json`,
  });
  return r.rows;
}

export async function createAnnotation(
  entryId: number,
  payload: { quote: string; ranges: Annotation["ranges"]; text: string | null },
): Promise<Annotation> {
  return authedRequest<Annotation>({
    method: "POST",
    path: `/api/annotations/${entryId}.json`,
    body: payload,
  });
}

export async function updateAnnotation(
  id: number,
  patch: { text?: string | null },
): Promise<Annotation> {
  return authedRequest<Annotation>({
    method: "PUT",
    path: `/api/annotations/${id}.json`,
    body: patch,
  });
}

export async function deleteAnnotation(id: number): Promise<void> {
  await authedRequest<unknown>({ method: "DELETE", path: `/api/annotations/${id}.json` });
}
```

- [ ] **Step 5: Add PUT to RequestArgs method union**

The current `src/api/client.ts` only allows `"GET" | "POST" | "PATCH" | "DELETE"`. Add `"PUT"`:

```ts
export type RequestArgs = {
  serverUrl: string;
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
};
```

- [ ] **Step 6: Run — expect 4 passed.**

- [ ] **Step 7: Commit**

```
feat(api): annotations CRUD bindings (list, create, update via PUT, delete)
```

---

## Task 12: Repo write event bus

Used by hooks to invalidate TanStack Query keys when SQLite mutations happen.

**Files:**
- Create: `src/sync/events.ts`, `tests/unit/events.test.ts`

- [ ] **Step 1: Failing test** at `tests/unit/events.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { dataEvents, type DataChangeEvent } from "@/sync/events";

describe("data events bus", () => {
  it("emits and unsubscribes", () => {
    const seen: DataChangeEvent[] = [];
    const off = dataEvents.subscribe((e) => seen.push(e));
    dataEvents.emit({ kind: "articles" });
    dataEvents.emit({ kind: "tags" });
    off();
    dataEvents.emit({ kind: "articles" });
    expect(seen.map((e) => e.kind)).toEqual(["articles", "tags"]);
  });

  it("multiple subscribers all fire", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = dataEvents.subscribe(a);
    const offB = dataEvents.subscribe(b);
    dataEvents.emit({ kind: "annotations", articleId: 1 });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    offB();
  });
});
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Implement `src/sync/events.ts`**

```ts
export type DataChangeEvent =
  | { kind: "articles" }
  | { kind: "article"; id: number }
  | { kind: "tags" }
  | { kind: "annotations"; articleId: number }
  | { kind: "sync-status" };

type Listener = (event: DataChangeEvent) => void;

class Bus {
  private listeners = new Set<Listener>();
  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }
  emit(e: DataChangeEvent): void {
    for (const l of this.listeners) l(e);
  }
}

export const dataEvents = new Bus();
```

- [ ] **Step 4: Run — expect 2 passed.**

- [ ] **Step 5: Commit**

```
feat(sync): data-change event bus for query invalidation
```

---

## Task 13: Sync engine — initial sync

Pulls every existing entry's metadata from Wallabag into SQLite. Lazy-loads `content` later when an article is opened.

**Files:**
- Create: `src/sync/engine.ts`, `tests/unit/sync-initial.test.ts`

- [ ] **Step 1: Failing test** at `tests/unit/sync-initial.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../src/test/msw-server";
import { createBetterSqliteDriver } from "@/db/driver-better-sqlite3";
import { runMigrations } from "@/db/migrations";
import type { DbDriver } from "@/db/driver";

const secure = new Map<string, string>();
const asyncMem = new Map<string, string>();
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (k: string) => secure.get(k) ?? null),
  setItemAsync: vi.fn(async (k: string, v: string) => void secure.set(k, v)),
  deleteItemAsync: vi.fn(async (k: string) => void secure.delete(k)),
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (k: string) => asyncMem.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => void asyncMem.set(k, v)),
    removeItem: vi.fn(async (k: string) => void asyncMem.delete(k)),
  },
}));

import { runInitialSync } from "@/sync/engine";
import { setDbForTesting } from "@/db";
import { applyTokenBundle } from "@/auth/tokens";

let db: DbDriver;

beforeEach(async () => {
  secure.clear();
  asyncMem.clear();
  secure.set("wb_client_id", "cid");
  secure.set("wb_client_secret", "cs");
  asyncMem.set("wb:server_url", "https://wb.test");
  await applyTokenBundle({
    access_token: "at",
    refresh_token: "rt",
    expires_in: 3600,
    token_type: "bearer",
  });
  db = await createBetterSqliteDriver(":memory:");
  await runMigrations(db);
  setDbForTesting(db);
});

const entry = (over: { id: number; updated_at?: string; tags?: { id: number; label: string; slug: string }[] }) => ({
  id: over.id,
  title: `T${over.id}`,
  url: `https://x/${over.id}`,
  domain_name: "x",
  content: null,
  preview_picture: null,
  reading_time: null,
  language: null,
  is_archived: 0 as const,
  is_starred: 0 as const,
  created_at: "2026-05-01T00:00:00Z",
  updated_at: over.updated_at ?? "2026-05-02T00:00:00Z",
  starred_at: null,
  archived_at: null,
  published_at: null,
  published_by: null,
  tags: over.tags ?? [],
});

describe("runInitialSync", () => {
  it("paginates until pages == 0 and writes articles + tags", async () => {
    let pageHits = 0;
    server.use(
      http.get("https://wb.test/api/entries.json", ({ request }) => {
        const u = new URL(request.url);
        const page = Number(u.searchParams.get("page"));
        pageHits++;
        if (page === 1) {
          return HttpResponse.json({
            page: 1,
            pages: 2,
            limit: 100,
            total: 3,
            _embedded: {
              items: [
                entry({ id: 1, tags: [{ id: 10, label: "Foo", slug: "foo" }] }),
                entry({ id: 2 }),
              ],
            },
          });
        }
        return HttpResponse.json({
          page: 2,
          pages: 2,
          limit: 100,
          total: 3,
          _embedded: { items: [entry({ id: 3 })] },
        });
      }),
      http.get("https://wb.test/api/tags.json", () =>
        HttpResponse.json([{ id: 10, label: "Foo", slug: "foo" }]),
      ),
    );

    await runInitialSync();

    expect(pageHits).toBe(2);
    const articles = await db.all<{ id: number }>("SELECT id FROM articles ORDER BY id");
    expect(articles.map((a) => a.id)).toEqual([1, 2, 3]);

    const tags = await db.all<{ slug: string }>("SELECT slug FROM tags");
    expect(tags.map((t) => t.slug)).toEqual(["foo"]);

    const link = await db.all<{ article_id: number; tag_id: number }>(
      "SELECT article_id, tag_id FROM article_tags",
    );
    expect(link).toEqual([{ article_id: 1, tag_id: 10 }]);
  });
});
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Implement `src/sync/engine.ts`**

```ts
import { getDb } from "@/db";
import { listEntries } from "@/api/entries";
import { listTags as apiListTags } from "@/api/tags";
import { upsertArticles, type ArticleRow } from "@/db/repos/articles";
import { upsertTags, attachTags } from "@/db/repos/tags";
import { setSyncValue } from "@/db/repos/sync-state";
import { dataEvents } from "./events";
import type { Entry } from "@/api/types";

const PER_PAGE = 100;

function entryToRow(e: Entry): Partial<ArticleRow> {
  return {
    id: e.id,
    title: e.title,
    url: e.url,
    domain_name: e.domain_name,
    content: e.content,
    preview_picture: e.preview_picture,
    reading_time: e.reading_time,
    language: e.language,
    is_archived: e.is_archived,
    is_starred: e.is_starred,
    created_at: e.created_at,
    updated_at: e.updated_at,
    starred_at: e.starred_at,
    archived_at: e.archived_at,
    published_at: e.published_at,
    published_by: e.published_by ? e.published_by.join(", ") : null,
    server_updated_at: e.updated_at,
  };
}

export async function runInitialSync(): Promise<void> {
  const db = await getDb();

  // Pull all tags first.
  const tags = await apiListTags();
  await upsertTags(db, tags);

  // Paginate entries.
  let page = 1;
  let totalPages = 1;
  let mostRecent: string | null = null;

  while (page <= totalPages) {
    const result = await listEntries({ page, perPage: PER_PAGE, detail: "metadata" });
    totalPages = result.pages;
    const rows = result._embedded.items.map(entryToRow);
    await upsertArticles(db, rows);

    // Re-link tags for each entry.
    for (const e of result._embedded.items) {
      if (e.tags.length > 0) {
        await attachTags(db, e.id, e.tags.map((t) => t.id));
      }
      if (!mostRecent || (e.updated_at && e.updated_at > mostRecent)) {
        mostRecent = e.updated_at;
      }
    }

    page += 1;
    if (totalPages === 0) break;
  }

  if (mostRecent) {
    await setSyncValue(db, "last_since", String(Math.floor(Date.parse(mostRecent) / 1000)));
  }
  await setSyncValue(db, "last_full_sync_at", new Date().toISOString());

  dataEvents.emit({ kind: "articles" });
  dataEvents.emit({ kind: "tags" });
  dataEvents.emit({ kind: "sync-status" });
}
```

- [ ] **Step 4: Run — expect 1 passed.**

- [ ] **Step 5: Commit**

```
feat(sync): initial sync paginates entries + tags into SQLite
```

---

## Task 14: Sync engine — incremental sync

**Files:**
- Modify: `src/sync/engine.ts`. Create: `tests/unit/sync-incremental.test.ts`.

- [ ] **Step 1: Failing test** at `tests/unit/sync-incremental.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../src/test/msw-server";
import { createBetterSqliteDriver } from "@/db/driver-better-sqlite3";
import { runMigrations } from "@/db/migrations";
import type { DbDriver } from "@/db/driver";

const secure = new Map<string, string>();
const asyncMem = new Map<string, string>();
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (k: string) => secure.get(k) ?? null),
  setItemAsync: vi.fn(async (k: string, v: string) => void secure.set(k, v)),
  deleteItemAsync: vi.fn(async (k: string) => void secure.delete(k)),
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (k: string) => asyncMem.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => void asyncMem.set(k, v)),
    removeItem: vi.fn(async (k: string) => void asyncMem.delete(k)),
  },
}));

import { runIncrementalSync } from "@/sync/engine";
import { setSyncValue } from "@/db/repos/sync-state";
import { setDbForTesting } from "@/db";
import { applyTokenBundle } from "@/auth/tokens";

let db: DbDriver;

beforeEach(async () => {
  secure.clear();
  asyncMem.clear();
  secure.set("wb_client_id", "cid");
  secure.set("wb_client_secret", "cs");
  asyncMem.set("wb:server_url", "https://wb.test");
  await applyTokenBundle({
    access_token: "at",
    refresh_token: "rt",
    expires_in: 3600,
    token_type: "bearer",
  });
  db = await createBetterSqliteDriver(":memory:");
  await runMigrations(db);
  setDbForTesting(db);
});

const entry = (id: number, updated: string) => ({
  id,
  title: `T${id}`,
  url: `https://x/${id}`,
  domain_name: "x",
  content: null,
  preview_picture: null,
  reading_time: null,
  language: null,
  is_archived: 0 as const,
  is_starred: 0 as const,
  created_at: "2026-05-01T00:00:00Z",
  updated_at: updated,
  starred_at: null,
  archived_at: null,
  published_at: null,
  published_by: null,
  tags: [],
});

describe("runIncrementalSync", () => {
  it("forwards stored since timestamp and updates it", async () => {
    await setSyncValue(db, "last_since", "1700000000");
    let capturedSince: string | null = null;
    server.use(
      http.get("https://wb.test/api/entries.json", ({ request }) => {
        capturedSince = new URL(request.url).searchParams.get("since");
        return HttpResponse.json({
          page: 1,
          pages: 1,
          limit: 100,
          total: 1,
          _embedded: { items: [entry(50, "2026-05-10T00:00:00Z")] },
        });
      }),
      http.get("https://wb.test/api/tags.json", () => HttpResponse.json([])),
    );

    await runIncrementalSync();

    expect(capturedSince).toBe("1700000000");
    const stored = await db.get<{ value: string }>(
      "SELECT value FROM sync_state WHERE key = 'last_since'",
    );
    expect(Number(stored?.value)).toBeGreaterThan(1700000000);
  });

  it("upserts updated entries", async () => {
    await db.run(
      "INSERT INTO articles (id, url, title, updated_at) VALUES (?, ?, ?, ?)",
      [50, "https://x/50", "Old", "2026-04-01T00:00:00Z"],
    );
    server.use(
      http.get("https://wb.test/api/entries.json", () =>
        HttpResponse.json({
          page: 1,
          pages: 1,
          limit: 100,
          total: 1,
          _embedded: { items: [entry(50, "2026-05-10T00:00:00Z")] },
        }),
      ),
      http.get("https://wb.test/api/tags.json", () => HttpResponse.json([])),
    );

    await runIncrementalSync();

    const a = await db.get<{ title: string; updated_at: string }>(
      "SELECT title, updated_at FROM articles WHERE id = 50",
    );
    expect(a?.title).toBe("T50");
    expect(a?.updated_at).toBe("2026-05-10T00:00:00Z");
  });
});
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Add to `src/sync/engine.ts`** (append):

```ts
import { getSyncValue } from "@/db/repos/sync-state";

export async function runIncrementalSync(): Promise<void> {
  const db = await getDb();
  const since = await getSyncValue(db, "last_since");
  const sinceNum = since ? Number(since) : undefined;

  const tags = await apiListTags();
  await upsertTags(db, tags);

  let page = 1;
  let totalPages = 1;
  let mostRecent: string | null = null;

  while (page <= totalPages) {
    const result = await listEntries({
      page,
      perPage: PER_PAGE,
      detail: "full",
      ...(sinceNum !== undefined ? { since: sinceNum } : {}),
    });
    totalPages = result.pages;
    if (result._embedded.items.length === 0) break;

    const rows = result._embedded.items.map(entryToRow);
    await upsertArticles(db, rows);

    for (const e of result._embedded.items) {
      if (e.tags.length > 0) {
        await attachTags(db, e.id, e.tags.map((t) => t.id));
      }
      if (!mostRecent || (e.updated_at && e.updated_at > mostRecent)) {
        mostRecent = e.updated_at;
      }
    }
    page += 1;
    if (totalPages === 0) break;
  }

  if (mostRecent) {
    await setSyncValue(db, "last_since", String(Math.floor(Date.parse(mostRecent) / 1000)));
  }

  dataEvents.emit({ kind: "articles" });
  dataEvents.emit({ kind: "tags" });
  dataEvents.emit({ kind: "sync-status" });
}
```

- [ ] **Step 4: Run — expect 2 passed.**

- [ ] **Step 5: Commit**

```
feat(sync): incremental sync via since cursor
```

---

## Task 15: Outbox drainer

**Files:**
- Create: `src/sync/outbox-drainer.ts`, `tests/unit/outbox-drainer.test.ts`

- [ ] **Step 1: Failing test** at `tests/unit/outbox-drainer.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../src/test/msw-server";
import { createBetterSqliteDriver } from "@/db/driver-better-sqlite3";
import { runMigrations } from "@/db/migrations";
import type { DbDriver } from "@/db/driver";

const secure = new Map<string, string>();
const asyncMem = new Map<string, string>();
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (k: string) => secure.get(k) ?? null),
  setItemAsync: vi.fn(async (k: string, v: string) => void secure.set(k, v)),
  deleteItemAsync: vi.fn(async (k: string) => void secure.delete(k)),
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (k: string) => asyncMem.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => void asyncMem.set(k, v)),
    removeItem: vi.fn(async (k: string) => void asyncMem.delete(k)),
  },
}));

import { drainOutbox } from "@/sync/outbox-drainer";
import { enqueue } from "@/db/repos/outbox";
import { setDbForTesting } from "@/db";
import { applyTokenBundle } from "@/auth/tokens";

let db: DbDriver;

beforeEach(async () => {
  secure.clear();
  asyncMem.clear();
  secure.set("wb_client_id", "cid");
  secure.set("wb_client_secret", "cs");
  asyncMem.set("wb:server_url", "https://wb.test");
  await applyTokenBundle({
    access_token: "at",
    refresh_token: "rt",
    expires_in: 3600,
    token_type: "bearer",
  });
  db = await createBetterSqliteDriver(":memory:");
  await runMigrations(db);
  setDbForTesting(db);
});

describe("drainOutbox", () => {
  it("processes updateEntry success and clears row", async () => {
    await db.run("INSERT INTO articles (id, url, pending_op) VALUES (?, ?, 'update')", [
      9,
      "https://x",
    ]);
    await enqueue(db, "updateEntry", { id: 9, is_starred: 1 });

    server.use(
      http.patch("https://wb.test/api/entries/9.json", () =>
        HttpResponse.json({
          id: 9,
          title: "T",
          url: "https://x",
          domain_name: "x",
          content: null,
          preview_picture: null,
          reading_time: null,
          language: null,
          is_archived: 0,
          is_starred: 1,
          created_at: "2026-05-01",
          updated_at: "2026-05-06",
          starred_at: "2026-05-06",
          archived_at: null,
          published_at: null,
          published_by: null,
          tags: [],
        }),
      ),
    );

    const summary = await drainOutbox();
    expect(summary.processed).toBe(1);
    expect(summary.failed).toBe(0);

    const remaining = await db.all("SELECT * FROM outbox");
    expect(remaining.length).toBe(0);

    const row = await db.get<{ pending_op: string | null }>(
      "SELECT pending_op FROM articles WHERE id = 9",
    );
    expect(row?.pending_op).toBeNull();
  });

  it("retries on failure with backoff", async () => {
    await db.run("INSERT INTO articles (id, url, pending_op) VALUES (?, ?, 'update')", [
      9,
      "https://x",
    ]);
    await enqueue(db, "updateEntry", { id: 9, is_starred: 1 });

    server.use(
      http.patch("https://wb.test/api/entries/9.json", () =>
        HttpResponse.json({ error: "server error" }, { status: 500 }),
      ),
    );

    const summary = await drainOutbox();
    expect(summary.processed).toBe(0);
    expect(summary.failed).toBe(1);

    const row = await db.get<{ attempts: number; last_error: string | null }>(
      "SELECT attempts, last_error FROM outbox LIMIT 1",
    );
    expect(row?.attempts).toBe(1);
    expect(row?.last_error).toBeTruthy();
  });

  it("createEntry rewrites temp negative id to real id", async () => {
    await db.run(
      "INSERT INTO articles (id, url, pending_op) VALUES (?, ?, 'create')",
      [-1, "https://example.com/post"],
    );
    await enqueue(db, "createEntry", {
      tempId: -1,
      url: "https://example.com/post",
      tags: ["a"],
    });

    server.use(
      http.post("https://wb.test/api/entries.json", () =>
        HttpResponse.json({
          id: 999,
          title: "Post",
          url: "https://example.com/post",
          domain_name: "example.com",
          content: null,
          preview_picture: null,
          reading_time: null,
          language: null,
          is_archived: 0,
          is_starred: 0,
          created_at: "2026-05-06",
          updated_at: "2026-05-06",
          starred_at: null,
          archived_at: null,
          published_at: null,
          published_by: null,
          tags: [],
        }),
      ),
    );

    const summary = await drainOutbox();
    expect(summary.processed).toBe(1);

    expect(await db.get("SELECT * FROM articles WHERE id = -1")).toBeNull();
    const real = await db.get<{ title: string }>(
      "SELECT title FROM articles WHERE id = 999",
    );
    expect(real?.title).toBe("Post");
  });
});
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Implement `src/sync/outbox-drainer.ts`**

```ts
import { getDb } from "@/db";
import {
  peekDue,
  markFailure,
  markSuccess,
  type OutboxOp,
  type OutboxRow,
} from "@/db/repos/outbox";
import { clearPendingOp, deleteArticle } from "@/db/repos/articles";
import { rewriteAnnotationId, purgeDeleted } from "@/db/repos/annotations";
import {
  createEntry,
  updateEntry,
  deleteEntry,
} from "@/api/entries";
import { addTagsToEntry, removeTagFromEntry } from "@/api/tags";
import {
  createAnnotation as apiCreateAnnotation,
  updateAnnotation as apiUpdateAnnotation,
  deleteAnnotation as apiDeleteAnnotation,
} from "@/api/annotations";
import { dataEvents } from "./events";

export type DrainSummary = { processed: number; failed: number };

const BATCH = 25;

type Payloads = {
  createEntry: { tempId: number; url: string; tags?: string[] };
  updateEntry: { id: number; is_starred?: 0 | 1; is_archived?: 0 | 1; tags?: string };
  deleteEntry: { id: number };
  addTag: { entryId: number; labels: string[] };
  removeTag: { entryId: number; tagId: number };
  createAnnotation: {
    tempId: number;
    entryId: number;
    quote: string;
    ranges: { start: string; startOffset: number; end: string; endOffset: number }[];
    text: string | null;
  };
  updateAnnotation: { id: number; text: string | null };
  deleteAnnotation: { id: number };
};

async function processOne(row: OutboxRow): Promise<void> {
  const op = row.op as OutboxOp;
  const payload = JSON.parse(row.payload_json) as Payloads[OutboxOp];
  const db = await getDb();

  switch (op) {
    case "createEntry": {
      const p = payload as Payloads["createEntry"];
      const real = await createEntry(p.url, p.tags);
      // Replace temp row with real one — drop the temp negative id and upsert the real entry.
      await db.run("DELETE FROM articles WHERE id = ?", [p.tempId]);
      await db.run(
        `INSERT INTO articles (id, title, url, domain_name, created_at, updated_at, server_updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at`,
        [
          real.id,
          real.title,
          real.url,
          real.domain_name,
          real.created_at,
          real.updated_at,
          real.updated_at,
        ],
      );
      dataEvents.emit({ kind: "articles" });
      return;
    }
    case "updateEntry": {
      const p = payload as Payloads["updateEntry"];
      await updateEntry(p.id, {
        ...(p.is_starred !== undefined ? { is_starred: p.is_starred } : {}),
        ...(p.is_archived !== undefined ? { is_archived: p.is_archived } : {}),
        ...(p.tags !== undefined ? { tags: p.tags } : {}),
      });
      await clearPendingOp(db, p.id);
      dataEvents.emit({ kind: "article", id: p.id });
      dataEvents.emit({ kind: "articles" });
      return;
    }
    case "deleteEntry": {
      const p = payload as Payloads["deleteEntry"];
      await deleteEntry(p.id);
      await deleteArticle(db, p.id);
      dataEvents.emit({ kind: "articles" });
      return;
    }
    case "addTag": {
      const p = payload as Payloads["addTag"];
      await addTagsToEntry(p.entryId, p.labels);
      dataEvents.emit({ kind: "article", id: p.entryId });
      return;
    }
    case "removeTag": {
      const p = payload as Payloads["removeTag"];
      await removeTagFromEntry(p.entryId, p.tagId);
      dataEvents.emit({ kind: "article", id: p.entryId });
      return;
    }
    case "createAnnotation": {
      const p = payload as Payloads["createAnnotation"];
      const real = await apiCreateAnnotation(p.entryId, {
        quote: p.quote,
        ranges: p.ranges,
        text: p.text,
      });
      await rewriteAnnotationId(db, p.tempId, real.id);
      dataEvents.emit({ kind: "annotations", articleId: p.entryId });
      return;
    }
    case "updateAnnotation": {
      const p = payload as Payloads["updateAnnotation"];
      await apiUpdateAnnotation(p.id, { text: p.text });
      // pending_op cleared by virtue of having no pending update.
      await db.run("UPDATE annotations SET pending_op = NULL WHERE id = ?", [p.id]);
      return;
    }
    case "deleteAnnotation": {
      const p = payload as Payloads["deleteAnnotation"];
      await apiDeleteAnnotation(p.id);
      await purgeDeleted(db, p.id);
      return;
    }
  }
}

export async function drainOutbox(): Promise<DrainSummary> {
  const db = await getDb();
  const due = await peekDue(db, BATCH);
  let processed = 0;
  let failed = 0;
  for (const row of due) {
    try {
      await processOne(row);
      await markSuccess(db, row.id);
      processed += 1;
    } catch (e) {
      await markFailure(db, row.id, e instanceof Error ? e.message : String(e));
      failed += 1;
    }
  }
  if (processed > 0 || failed > 0) {
    dataEvents.emit({ kind: "sync-status" });
  }
  return { processed, failed };
}
```

- [ ] **Step 4: Run — expect 3 passed.**

- [ ] **Step 5: Commit**

```
feat(sync): outbox drainer with per-op handlers and id rewriting
```

---

## Task 16: useSyncStatus + useSyncNow hooks

These give the UI a way to render sync state and a way to trigger sync manually.

**Files:**
- Create: `src/hooks/useSyncStatus.ts`, `src/hooks/useSyncNow.ts`

(No new tests — these are thin wrappers over existing tested code, and TanStack Query has its own test surface. We test them indirectly when the UI tests in Phase 3 land.)

- [ ] **Step 1: Implement `src/hooks/useSyncStatus.ts`**

```ts
import { useEffect, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataEvents, type DataChangeEvent } from "@/sync/events";
import { getDb } from "@/db";
import { getSyncValue } from "@/db/repos/sync-state";

export type SyncStatus = {
  lastFullSyncAt: string | null;
  lastSince: string | null;
};

async function readStatus(): Promise<SyncStatus> {
  const db = await getDb();
  return {
    lastFullSyncAt: await getSyncValue(db, "last_full_sync_at"),
    lastSince: await getSyncValue(db, "last_since"),
  };
}

let version = 0;
const versionListeners = new Set<() => void>();

dataEvents.subscribe((e: DataChangeEvent) => {
  if (e.kind === "sync-status") {
    version += 1;
    for (const l of versionListeners) l();
  }
});

function useEventVersion(): number {
  return useSyncExternalStore(
    (cb) => {
      versionListeners.add(cb);
      return () => {
        versionListeners.delete(cb);
      };
    },
    () => version,
    () => version,
  );
}

export function useSyncStatus() {
  const v = useEventVersion();
  return useQuery({
    queryKey: ["sync-status", v],
    queryFn: readStatus,
    staleTime: 0,
  });
}

// Helper for repos to use
export function useDataChange(kind: DataChangeEvent["kind"], cb: () => void): void {
  useEffect(() => {
    return dataEvents.subscribe((e) => {
      if (e.kind === kind) cb();
    });
  }, [kind, cb]);
}
```

- [ ] **Step 2: Implement `src/hooks/useSyncNow.ts`**

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { runIncrementalSync } from "@/sync/engine";
import { drainOutbox } from "@/sync/outbox-drainer";

export function useSyncNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await drainOutbox();
      await runIncrementalSync();
    },
    onSettled: () => {
      qc.invalidateQueries();
    },
  });
}
```

- [ ] **Step 3: Run** `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm format:check` — all pass.

- [ ] **Step 4: Commit**

```
feat(hooks): useSyncStatus + useSyncNow
```

---

## Task 17: useArticles + useArticle hooks

**Files:**
- Create: `src/hooks/useArticles.ts`, `src/hooks/useArticle.ts`

- [ ] **Step 1: Implement `src/hooks/useArticles.ts`**

```ts
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listArticles, type Filter } from "@/db/repos/articles";
import { tagsForArticle } from "@/db/repos/tags";
import { getDb } from "@/db";
import { dataEvents } from "@/sync/events";

export type ArticleListItem = Awaited<ReturnType<typeof listArticles>>[number] & {
  tags: Awaited<ReturnType<typeof tagsForArticle>>;
};

async function fetchList(filter: Filter): Promise<ArticleListItem[]> {
  const db = await getDb();
  const rows = await listArticles(db, { filter });
  const enriched = await Promise.all(
    rows.map(async (r) => ({ ...r, tags: await tagsForArticle(db, r.id) })),
  );
  return enriched;
}

export function useArticles(filter: Filter) {
  const qc = useQueryClient();
  useEffect(() => {
    return dataEvents.subscribe((e) => {
      if (e.kind === "articles" || e.kind === "tags") {
        qc.invalidateQueries({ queryKey: ["articles"] });
      }
    });
  }, [qc]);
  return useQuery({
    queryKey: ["articles", { filter }],
    queryFn: () => fetchList(filter),
    staleTime: 5_000,
  });
}
```

- [ ] **Step 2: Implement `src/hooks/useArticle.ts`**

```ts
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getArticle } from "@/db/repos/articles";
import { tagsForArticle } from "@/db/repos/tags";
import { getDb } from "@/db";
import { dataEvents } from "@/sync/events";

async function fetchOne(id: number) {
  const db = await getDb();
  const row = await getArticle(db, id);
  if (!row) return null;
  const tags = await tagsForArticle(db, id);
  return { ...row, tags };
}

export function useArticle(id: number) {
  const qc = useQueryClient();
  useEffect(() => {
    return dataEvents.subscribe((e) => {
      if (e.kind === "article" && e.id === id) {
        qc.invalidateQueries({ queryKey: ["article", id] });
      }
      if (e.kind === "articles") {
        qc.invalidateQueries({ queryKey: ["article", id] });
      }
    });
  }, [qc, id]);
  return useQuery({
    queryKey: ["article", id],
    queryFn: () => fetchOne(id),
    staleTime: 0,
  });
}
```

- [ ] **Step 3: All four checks pass.**

- [ ] **Step 4: Commit**

```
feat(hooks): useArticles + useArticle reading from SQLite via TanStack Query
```

---

## Task 18: useTags + useAnnotations hooks

**Files:**
- Create: `src/hooks/useTags.ts`, `src/hooks/useAnnotations.ts`

- [ ] **Step 1: Implement `src/hooks/useTags.ts`**

```ts
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listTags } from "@/db/repos/tags";
import { getDb } from "@/db";
import { dataEvents } from "@/sync/events";

export function useTags() {
  const qc = useQueryClient();
  useEffect(() => {
    return dataEvents.subscribe((e) => {
      if (e.kind === "tags") qc.invalidateQueries({ queryKey: ["tags"] });
    });
  }, [qc]);
  return useQuery({
    queryKey: ["tags"],
    queryFn: async () => listTags(await getDb()),
    staleTime: 30_000,
  });
}
```

- [ ] **Step 2: Implement `src/hooks/useAnnotations.ts`**

```ts
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listAnnotations } from "@/db/repos/annotations";
import { getDb } from "@/db";
import { dataEvents } from "@/sync/events";

export function useAnnotations(articleId: number) {
  const qc = useQueryClient();
  useEffect(() => {
    return dataEvents.subscribe((e) => {
      if (e.kind === "annotations" && e.articleId === articleId) {
        qc.invalidateQueries({ queryKey: ["annotations", articleId] });
      }
    });
  }, [qc, articleId]);
  return useQuery({
    queryKey: ["annotations", articleId],
    queryFn: async () => listAnnotations(await getDb(), articleId),
    staleTime: 0,
  });
}
```

- [ ] **Step 3: All four checks pass.**

- [ ] **Step 4: Commit**

```
feat(hooks): useTags + useAnnotations
```

---

## Task 19: Sign-out drops the database

When the user signs out we already wipe SecureStore and AsyncStorage; we also need to drop the SQLite database file/contents so the next user doesn't see the previous user's articles.

**Files:**
- Modify: `src/auth/state.ts`, `src/db/index.ts` (already has `resetDb`).

- [ ] **Step 1: Failing test** — extend `tests/unit/auth-state.test.ts` with one more test:

Add to the existing `describe("auth state")`:

```ts
it("signOut wipes SQLite content", async () => {
  // We can't easily call the real getDb() here because it goes through
  // expo-sqlite. Instead inject a fake driver that records `close()` calls.
  const { setDbForTesting } = await import("@/db");
  const closed = vi.fn();
  setDbForTesting({
    exec: vi.fn(),
    run: vi.fn(),
    get: vi.fn(),
    all: vi.fn(),
    transaction: vi.fn(),
    close: closed,
  } as never);

  await signIn({
    serverUrl: "https://wb.test",
    clientId: "cid",
    clientSecret: "cs",
    username: "u",
    bundle: { access_token: "at", refresh_token: "rt", expires_in: 3600, token_type: "bearer" },
  });
  await signOut();
  expect(closed).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Update `src/auth/state.ts`** to close the database in `signOut`. Add to the imports:

```ts
import { resetDb } from "@/db";
```

Update `signOut`:

```ts
export async function signOut(): Promise<void> {
  await clearTokens();
  await resetDb();
  await kvRemove("server_url");
  await kvRemove("last_user_id");
  authStore.set({ status: "unauthenticated", serverUrl: null });
}
```

We don't delete the underlying SQLite file (Expo SQLite doesn't expose that easily on web, and the next sign-in will re-run migrations into an empty DB if we ALSO truncate tables). For correctness, we ALSO truncate user data. Add a helper to `src/db/index.ts`:

```ts
export async function clearAllData(): Promise<void> {
  if (!cached) return;
  const driver = await cached;
  await driver.transaction(async (tx) => {
    await tx.exec(`
      DELETE FROM article_tags;
      DELETE FROM annotations;
      DELETE FROM tags;
      DELETE FROM articles;
      DELETE FROM outbox;
      DELETE FROM sync_state;
    `);
  });
}
```

And in `signOut`:

```ts
import { clearAllData, resetDb } from "@/db";
// ...
export async function signOut(): Promise<void> {
  await clearAllData();
  await resetDb();
  await clearTokens();
  await kvRemove("server_url");
  await kvRemove("last_user_id");
  authStore.set({ status: "unauthenticated", serverUrl: null });
}
```

- [ ] **Step 4: Run — expect all auth-state tests pass.**

- [ ] **Step 5: Commit**

```
feat(auth): signOut clears SQLite content and resets db handle
```

---

## Task 20: README + plan handoff to Phase 3

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the `## Status` section** of `README.md`:

```markdown
## Status

Phase 1 (Foundation) complete:
- Two-step onboarding wizard (server URL + OAuth credentials)
- Token storage and auto-refresh
- Sign-in / sign-out
- Theming (light / dark / sepia / auto)

Phase 2 (Data layer) complete:
- SQLite schema + migration runner
- Articles / tags / annotations / outbox / sync-state repos
- Wallabag entries / tags / annotations API bindings
- Sync engine: initial sync, incremental sync via `since` cursor
- Outbox drainer with exponential backoff
- TanStack Query hooks: useArticles, useArticle, useTags, useAnnotations, useSyncStatus, useSyncNow
- Sign-out wipes SQLite content

Library UI, reader, and share targets arrive in later phases.
```

- [ ] **Step 2: Commit**

```
docs: README for Phase 2
```

---

## Self-review

**Spec coverage check (Phase 2 scope only):**

| Spec section | Covered by |
|---|---|
| §6.1 SQLite schema (articles, tags, article_tags, annotations, outbox, sync_state) | Task 3 |
| §6.1 articles_fts virtual table | **Deferred to Phase 3 (search UI)** |
| §6.1 images table | **Deferred to Phase 4 (reader)** |
| §6.2 Initial sync | Task 13 |
| §6.2 Incremental sync (since cursor) | Task 14 |
| §6.2 drainOutbox | Task 15 |
| §6.2 Conflict resolution (last-write-wins) | Task 13/14 (`server_updated_at` written on incoming entries; outbox writes overlay) |
| §6.3 Outbox semantics (optimistic + queue + backoff) | Task 7 (repo) + Task 15 (drainer) |
| §6.4 Image caching | **Deferred to Phase 4** |
| §6.5 TanStack Query keys | Tasks 16, 17, 18 |
| §11 Testing of repos / sync engine / drainer | Tasks 4–8, 13–15 |
| Sign-out wipes data | Task 19 |

**Placeholder scan:** None. Every step has actual code.

**Type consistency:**
- `DbDriver` interface defined in Task 1, consumed by Tasks 2–8, 13–15, 17–19. Same shape throughout.
- `ArticleRow` defined in Task 5, consumed by sync engine (Tasks 13/14) via `entryToRow()` returning `Partial<ArticleRow>`.
- `OutboxOp` defined in Task 7, consumed by Task 15 with full switch coverage.
- `Entry` and `EntryTag` defined in Task 9, consumed by Tasks 13/14 (sync engine) and Task 15 (drainer's createEntry handler).
- `Annotation` defined in Task 11, consumed by Task 15 (createAnnotation/updateAnnotation/deleteAnnotation handlers).
- `dataEvents` defined in Task 12, consumed by Tasks 13–18.

**Cross-task call graph audit:**
- `getDb()` (Task 2) used by every sync function (Tasks 13–15) and every hook (Tasks 16–18).
- `setDbForTesting()` (Task 2) used by all sync/drainer tests (Tasks 13, 14, 15, 19) so they don't go through `expo-sqlite`.
- `authedRequest` (Phase 1) used by every API binding (Tasks 9, 10, 11). The `"PUT"` method gets added to the union in Task 11 step 5.
- `enqueue()` (Task 7) is the entry point for any future repo mutation that needs to outbox; Phase 3 UI mutations will wrap repo updates with `enqueue()` calls.

**Out of scope by design (later phases):**
- FTS5 (Phase 3)
- Image cache (Phase 4)
- Background sync while app closed (deferred to MVP+1 per spec §15)
- Mutation hooks (e.g. `useToggleStarred`) — these get added in Phase 3 alongside the UI that needs them, since their optimistic-update shape is UI-driven.
