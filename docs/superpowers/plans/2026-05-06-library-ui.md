# Library UI Implementation Plan (Phase 3 of 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app feel like a real Wallabag client. After sign-in, the user sees their library, filters by Unread/Starred/Archive/All/Tag, searches articles, taps to open a placeholder reader, toggles star/archive, and sees sync status. Phone layout uses a bottom tab bar; desktop renders a two-pane rail+list shell that matches the prototype.

**Architecture:** Routes live in `app/(app)/(library)/*` and read from the data layer via the Phase-2 hooks (`useArticles`, `useTags`, `useSearchArticles`). Mutations go through three new hooks (`useToggleStarred`, `useToggleArchived`, `useDeleteArticle`) that write SQLite optimistically and enqueue to the outbox. A small FTS5 migration (002) gives us full-text search. Initial sync auto-runs once after sign-in; incremental sync runs on app foreground and on pull-to-refresh.

**Tech Stack:** Expo Router (file-based routes, Tabs + Stack), `@shopify/flash-list` for virtualized lists, NativeWind for the prototype's serif/cream aesthetic, TanStack Query for sync state, Phase-1 token+API stack for everything network-side.

**Reference spec:** `docs/superpowers/specs/2026-05-06-wallabag-expo-client-design.md` §7 (screens & navigation) and §6.5 (query keys).

**Phase 3 explicitly defers:**
- Reader content rendering & annotations → Phase 4 (the `/article/[id]` route lands as a placeholder showing title + url + back button).
- Add-article-by-URL UI → Phase 5 (share extension phase will land both the in-app modal and the native targets).
- Image cache → Phase 4 (article previews on the list use the network URL directly for now; cache layer arrives with the reader).
- Meta pane (third column on desktop showing article preview) → Phase 4 alongside the reader; Phase 3 ships rail + list.

---

## File map for this plan

```
src/
├── components/
│   ├── ArticleCard.tsx              # row in the list
│   ├── ArticleList.tsx              # virtualized list + pull-to-refresh
│   ├── EmptyState.tsx
│   ├── LibraryHeader.tsx            # display title + count + filter chip
│   ├── Rail.tsx                     # desktop rail (filters + tag list)
│   ├── TabBar.tsx                   # phone bottom tab bar
│   └── TagChip.tsx
├── db/migrations/
│   └── 002_fts.sql                  # FTS5 virtual table + triggers
├── db/repos/
│   └── articles.ts                  # extend with searchArticles()
├── hooks/
│   ├── useToggleStarred.ts
│   ├── useToggleArchived.ts
│   ├── useDeleteArticle.ts
│   ├── useSearchArticles.ts
│   ├── useBootstrapSync.ts          # initial+incremental triggers
│   └── useResponsive.ts             # breakpoint helper

app/
└── (app)/
    ├── _layout.tsx                  # Stack + responsive tab bar gate
    ├── (library)/
    │   ├── _layout.tsx              # library shell (responsive: phone full-width / desktop rail+list)
    │   ├── index.tsx                # Unread (default)
    │   ├── starred.tsx
    │   ├── archive.tsx
    │   ├── all.tsx
    │   ├── search.tsx
    │   └── tags/[tag].tsx
    ├── article/[id].tsx             # placeholder reader
    └── settings.tsx                 # extended

tests/
├── unit/
│   ├── migrations-fts.test.ts
│   ├── repo-articles-search.test.ts
│   ├── hook-mutations.test.ts
│   └── repo-articles-search.test.ts
└── ui/
    ├── article-card.test.tsx
    ├── library-screen.test.tsx
    └── search-screen.test.tsx
```

17 tasks.

---

## Task 1: FTS5 migration

**Files:** Create `src/db/migrations/002_fts.sql`. Modify `src/db/migrations/index.ts`. Test: `tests/unit/migrations-fts.test.ts`.

- [ ] **Step 1: Failing test** at `tests/unit/migrations-fts.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createBetterSqliteDriver } from "@/db/driver-better-sqlite3";
import { runMigrations } from "@/db/migrations";
import type { DbDriver } from "@/db/driver";

let db: DbDriver;

beforeEach(async () => {
  db = await createBetterSqliteDriver(":memory:");
  await runMigrations(db);
});

describe("FTS5 migration", () => {
  it("creates the articles_fts virtual table", async () => {
    const row = await db.get<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'articles_fts'",
    );
    expect(row?.name).toBe("articles_fts");
  });

  it("inserting an article populates FTS via trigger", async () => {
    await db.run(
      "INSERT INTO articles (id, url, title, content) VALUES (?, ?, ?, ?)",
      [1, "https://x", "Hello world", "Body text about cats"],
    );
    const r = await db.all<{ id: number }>(
      "SELECT rowid AS id FROM articles_fts WHERE articles_fts MATCH ?",
      ["cats"],
    );
    expect(r).toEqual([{ id: 1 }]);
  });

  it("updating an article updates FTS via trigger", async () => {
    await db.run(
      "INSERT INTO articles (id, url, title, content) VALUES (?, ?, ?, ?)",
      [1, "https://x", "Hello", "first"],
    );
    await db.run("UPDATE articles SET content = ? WHERE id = ?", ["second body", 1]);
    const r = await db.all<{ id: number }>(
      "SELECT rowid AS id FROM articles_fts WHERE articles_fts MATCH ?",
      ["second"],
    );
    expect(r).toEqual([{ id: 1 }]);
  });

  it("deleting an article removes from FTS via trigger", async () => {
    await db.run(
      "INSERT INTO articles (id, url, title, content) VALUES (?, ?, ?, ?)",
      [1, "https://x", "Hello", "body"],
    );
    await db.run("DELETE FROM articles WHERE id = 1");
    const r = await db.all<{ id: number }>(
      "SELECT rowid AS id FROM articles_fts WHERE articles_fts MATCH ?",
      ["body"],
    );
    expect(r).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test** — expect FAIL.

- [ ] **Step 3: Create `src/db/migrations/002_fts.sql`**:

```sql
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
```

- [ ] **Step 4: Register migration 002** in `src/db/migrations/index.ts`. Read the file first, then add the import and append to the `MIGRATIONS` array:

```ts
import sql001 from "./001_initial.sql";
import sql002 from "./002_fts.sql";

const MIGRATIONS: readonly Migration[] = [
  { version: 1, sql: sql001 as unknown as string, name: "001_initial" },
  { version: 2, sql: sql002 as unknown as string, name: "002_fts" },
];
```

- [ ] **Step 5: Run tests** — expect 4 passed.

- [ ] **Step 6: Commit**:

```
feat(db): FTS5 virtual table + triggers for full-text article search
```

---

## Task 2: searchArticles repo function

**Files:** Modify `src/db/repos/articles.ts` to add `searchArticles`. Test: `tests/unit/repo-articles-search.test.ts`.

- [ ] **Step 1: Failing test** at `tests/unit/repo-articles-search.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createBetterSqliteDriver } from "@/db/driver-better-sqlite3";
import { runMigrations } from "@/db/migrations";
import type { DbDriver } from "@/db/driver";
import { searchArticles, upsertArticles } from "@/db/repos/articles";

let db: DbDriver;

beforeEach(async () => {
  db = await createBetterSqliteDriver(":memory:");
  await runMigrations(db);
});

const sample = (over: { id: number; title?: string; content?: string; url?: string; updated_at?: string }) => ({
  id: over.id,
  title: over.title ?? null,
  url: over.url ?? `https://x/${over.id}`,
  domain_name: "x",
  content: over.content ?? null,
  preview_picture: null,
  reading_time: null,
  language: null,
  is_archived: 0,
  is_starred: 0,
  created_at: "2026-05-01T00:00:00Z",
  updated_at: over.updated_at ?? "2026-05-02T00:00:00Z",
  starred_at: null,
  archived_at: null,
  published_at: null,
  published_by: null,
});

describe("searchArticles", () => {
  it("returns empty array for empty query", async () => {
    expect(await searchArticles(db, "")).toEqual([]);
    expect(await searchArticles(db, "   ")).toEqual([]);
  });

  it("matches title", async () => {
    await upsertArticles(db, [
      sample({ id: 1, title: "Cats are great" }),
      sample({ id: 2, title: "Dogs love walking" }),
    ]);
    const r = await searchArticles(db, "cats");
    expect(r.map((a) => a.id)).toEqual([1]);
  });

  it("matches content", async () => {
    await upsertArticles(db, [
      sample({ id: 1, title: "Travel", content: "best parisian cafes" }),
      sample({ id: 2, title: "Tech", content: "rust compilers" }),
    ]);
    const r = await searchArticles(db, "parisian");
    expect(r.map((a) => a.id)).toEqual([1]);
  });

  it("matches url", async () => {
    await upsertArticles(db, [
      sample({ id: 1, title: "T", url: "https://nytimes.com/path" }),
    ]);
    const r = await searchArticles(db, "nytimes");
    expect(r.map((a) => a.id)).toEqual([1]);
  });

  it("orders by updated_at DESC", async () => {
    await upsertArticles(db, [
      sample({ id: 1, title: "match older", updated_at: "2026-05-01T00:00:00Z" }),
      sample({ id: 2, title: "match newer", updated_at: "2026-05-05T00:00:00Z" }),
    ]);
    const r = await searchArticles(db, "match");
    expect(r.map((a) => a.id)).toEqual([2, 1]);
  });

  it("ignores SQL-special characters in the query", async () => {
    await upsertArticles(db, [sample({ id: 1, title: "hello world" })]);
    // FTS5 considers `:` and other punctuation as tokens; we should not throw.
    expect(await searchArticles(db, "hello: world!")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Implement `searchArticles`** in `src/db/repos/articles.ts`. Read the file first, then add this near the bottom:

```ts
const COLS = [
  "id", "title", "url", "domain_name", "content", "preview_picture", "reading_time",
  "language", "is_archived", "is_starred", "created_at", "updated_at", "starred_at",
  "archived_at", "published_at", "published_by", "scroll_position", "server_updated_at",
  "local_updated_at", "pending_op",
] as const;
// (already present — do not duplicate; reference for the searchArticles SELECT below)

function toFtsQuery(input: string): string {
  // Strip FTS-meta characters and quote each remaining whitespace-separated
  // token so user input like `hello world!` becomes `"hello" "world"`.
  const tokens = input
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t}"`);
  return tokens.join(" ");
}

export async function searchArticles(db: DbDriver, query: string): Promise<ArticleRow[]> {
  const q = query.trim();
  if (q.length === 0) return [];
  const ftsQuery = toFtsQuery(q);
  if (ftsQuery.length === 0) return [];
  return db.all<ArticleRow>(
    `SELECT ${COLS.map((c) => "a." + c).join(", ")}
     FROM articles_fts f
     JOIN articles a ON a.id = f.rowid
     WHERE articles_fts MATCH ?
     ORDER BY a.updated_at DESC
     LIMIT 200`,
    [ftsQuery],
  );
}
```

- [ ] **Step 4: Run** — expect 6 passed.

- [ ] **Step 5: Commit**:

```
feat(db): searchArticles repo function over FTS5
```

---

## Task 3: Mutation hooks (useToggleStarred / useToggleArchived / useDeleteArticle)

**Files:** Create `src/hooks/useToggleStarred.ts`, `src/hooks/useToggleArchived.ts`, `src/hooks/useDeleteArticle.ts`. Test: `tests/unit/hook-mutations.test.ts`.

These hooks: write SQLite via the repo, enqueue to the outbox, emit `dataEvents`. They DO NOT immediately call the API — the drainer handles that.

- [ ] **Step 1: Failing test** at `tests/unit/hook-mutations.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
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

import { setDbForTesting } from "@/db";
import { toggleStarredAction } from "@/hooks/useToggleStarred";
import { toggleArchivedAction } from "@/hooks/useToggleArchived";
import { deleteArticleAction } from "@/hooks/useDeleteArticle";

let db: DbDriver;

beforeEach(async () => {
  secure.clear();
  asyncMem.clear();
  db = await createBetterSqliteDriver(":memory:");
  await runMigrations(db);
  await db.run(
    "INSERT INTO articles (id, url, is_starred, is_archived) VALUES (?, ?, 0, 0)",
    [9, "https://x"],
  );
  setDbForTesting(db);
});

describe("toggleStarredAction", () => {
  it("toggles is_starred and enqueues updateEntry", async () => {
    await toggleStarredAction(9, true);
    const a = await db.get<{ is_starred: number; pending_op: string }>(
      "SELECT is_starred, pending_op FROM articles WHERE id = 9",
    );
    expect(a?.is_starred).toBe(1);
    expect(a?.pending_op).toBe("update");
    const job = await db.get<{ op: string; payload_json: string }>(
      "SELECT op, payload_json FROM outbox LIMIT 1",
    );
    expect(job?.op).toBe("updateEntry");
    expect(JSON.parse(job!.payload_json)).toEqual({ id: 9, is_starred: 1 });
  });
});

describe("toggleArchivedAction", () => {
  it("toggles is_archived and enqueues updateEntry", async () => {
    await toggleArchivedAction(9, true);
    const a = await db.get<{ is_archived: number }>(
      "SELECT is_archived FROM articles WHERE id = 9",
    );
    expect(a?.is_archived).toBe(1);
    const job = await db.get<{ payload_json: string }>(
      "SELECT payload_json FROM outbox LIMIT 1",
    );
    expect(JSON.parse(job!.payload_json)).toEqual({ id: 9, is_archived: 1 });
  });
});

describe("deleteArticleAction", () => {
  it("removes locally and enqueues deleteEntry", async () => {
    await deleteArticleAction(9);
    const a = await db.get("SELECT * FROM articles WHERE id = 9");
    expect(a).toBeNull();
    const job = await db.get<{ op: string; payload_json: string }>(
      "SELECT op, payload_json FROM outbox LIMIT 1",
    );
    expect(job?.op).toBe("deleteEntry");
    expect(JSON.parse(job!.payload_json)).toEqual({ id: 9 });
  });
});
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Implement `src/hooks/useToggleStarred.ts`**:

```ts
import { useMutation } from "@tanstack/react-query";
import { getDb } from "@/db";
import { setStarred } from "@/db/repos/articles";
import { enqueue } from "@/db/repos/outbox";
import { dataEvents } from "@/sync/events";

export async function toggleStarredAction(articleId: number, starred: boolean): Promise<void> {
  const db = await getDb();
  await setStarred(db, articleId, starred);
  await enqueue(db, "updateEntry", { id: articleId, is_starred: starred ? 1 : 0 });
  dataEvents.emit({ kind: "article", id: articleId });
  dataEvents.emit({ kind: "articles" });
}

export function useToggleStarred() {
  return useMutation({
    mutationFn: ({ id, starred }: { id: number; starred: boolean }) =>
      toggleStarredAction(id, starred),
  });
}
```

- [ ] **Step 4: Implement `src/hooks/useToggleArchived.ts`**:

```ts
import { useMutation } from "@tanstack/react-query";
import { getDb } from "@/db";
import { setArchived } from "@/db/repos/articles";
import { enqueue } from "@/db/repos/outbox";
import { dataEvents } from "@/sync/events";

export async function toggleArchivedAction(articleId: number, archived: boolean): Promise<void> {
  const db = await getDb();
  await setArchived(db, articleId, archived);
  await enqueue(db, "updateEntry", { id: articleId, is_archived: archived ? 1 : 0 });
  dataEvents.emit({ kind: "article", id: articleId });
  dataEvents.emit({ kind: "articles" });
}

export function useToggleArchived() {
  return useMutation({
    mutationFn: ({ id, archived }: { id: number; archived: boolean }) =>
      toggleArchivedAction(id, archived),
  });
}
```

- [ ] **Step 5: Implement `src/hooks/useDeleteArticle.ts`**:

```ts
import { useMutation } from "@tanstack/react-query";
import { getDb } from "@/db";
import { deleteArticle } from "@/db/repos/articles";
import { enqueue } from "@/db/repos/outbox";
import { dataEvents } from "@/sync/events";

export async function deleteArticleAction(articleId: number): Promise<void> {
  const db = await getDb();
  // Enqueue first because deleteArticle row-removes; we still want the API call.
  await enqueue(db, "deleteEntry", { id: articleId });
  await deleteArticle(db, articleId);
  dataEvents.emit({ kind: "articles" });
}

export function useDeleteArticle() {
  return useMutation({
    mutationFn: (id: number) => deleteArticleAction(id),
  });
}
```

- [ ] **Step 6: Run tests** — expect 3 passed.

- [ ] **Step 7: Commit**:

```
feat(hooks): mutation hooks (toggle starred/archived, delete) with optimistic + outbox enqueue
```

---

## Task 4: Search hook

**Files:** Create `src/hooks/useSearchArticles.ts`.

- [ ] **Step 1: Implement** `src/hooks/useSearchArticles.ts`:

```ts
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { searchArticles } from "@/db/repos/articles";
import { tagsForArticle } from "@/db/repos/tags";
import { getDb } from "@/db";
import { dataEvents } from "@/sync/events";

async function runSearch(q: string) {
  const db = await getDb();
  const rows = await searchArticles(db, q);
  return Promise.all(
    rows.map(async (r) => ({ ...r, tags: await tagsForArticle(db, r.id) })),
  );
}

export function useSearchArticles(query: string) {
  const qc = useQueryClient();
  useEffect(() => {
    return dataEvents.subscribe((e) => {
      if (e.kind === "articles") qc.invalidateQueries({ queryKey: ["search"] });
    });
  }, [qc]);
  return useQuery({
    queryKey: ["search", query],
    queryFn: () => runSearch(query),
    enabled: query.trim().length > 0,
    staleTime: 5_000,
  });
}
```

- [ ] **Step 2: Verify** `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm format:check`.

- [ ] **Step 3: Commit**:

```
feat(hooks): useSearchArticles backed by FTS5
```

---

## Task 5: Bootstrap sync hook (auto-sync on launch + foreground)

**Files:** Create `src/hooks/useBootstrapSync.ts`. Modify `app/_layout.tsx` to use it.

- [ ] **Step 1: Implement** `src/hooks/useBootstrapSync.ts`:

```ts
import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useAuth } from "@/hooks/useAuth";
import { runInitialSync, runIncrementalSync } from "@/sync/engine";
import { drainOutbox } from "@/sync/outbox-drainer";
import { getDb } from "@/db";
import { getSyncValue } from "@/db/repos/sync-state";

/**
 * Runs initial sync once after sign-in, then incremental sync + outbox drain
 * on every app foreground transition.
 */
export function useBootstrapSync(): void {
  const auth = useAuth();
  const initialDoneRef = useRef(false);

  useEffect(() => {
    if (auth.status !== "authenticated") {
      initialDoneRef.current = false;
      return;
    }

    let cancelled = false;
    (async () => {
      const db = await getDb();
      const lastFull = await getSyncValue(db, "last_full_sync_at");
      if (!initialDoneRef.current && !lastFull) {
        await runInitialSync().catch(() => {
          /* swallow — surfaces in sync status */
        });
      } else {
        await drainOutbox().catch(() => {});
        await runIncrementalSync().catch(() => {});
      }
      if (!cancelled) initialDoneRef.current = true;
    })();

    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active" && initialDoneRef.current) {
        void drainOutbox()
          .catch(() => {})
          .then(() => runIncrementalSync().catch(() => {}));
      }
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [auth.status]);
}
```

- [ ] **Step 2: Wire into the root layout.** Read `app/_layout.tsx`, then add the hook inside the `AuthGate` component (so it only runs when authenticated):

```tsx
import { useBootstrapSync } from "@/hooks/useBootstrapSync";

function AuthGate() {
  const auth = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const inAuthGroup = segments[0] === "(auth)";
  // ... existing redirect effect ...
  useBootstrapSync();
  // ... existing render logic ...
}
```

(Keep all the existing AuthGate body; just add the `useBootstrapSync()` call near the other hook calls.)

- [ ] **Step 3: Verify** `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm format:check`.

- [ ] **Step 4: Commit**:

```
feat(sync): auto initial sync after sign-in + incremental on foreground
```

---

## Task 6: ArticleCard component

**Files:** Create `src/components/ArticleCard.tsx` and `src/components/TagChip.tsx`. Test: `tests/ui/article-card.test.tsx`.

- [ ] **Step 1: Implement `src/components/TagChip.tsx`**:

```tsx
import { Text, View } from "react-native";

export function TagChip({ label }: { label: string }) {
  return (
    <View className="px-2 py-0.5 border border-border bg-surface rounded-full mr-1.5">
      <Text className="text-muted text-xs">{label}</Text>
    </View>
  );
}
```

- [ ] **Step 2: Implement `src/components/ArticleCard.tsx`**:

```tsx
import { Pressable, Text, View } from "react-native";
import { Link } from "expo-router";
import { TagChip } from "./TagChip";

export type ArticleCardProps = {
  id: number;
  title: string | null;
  url: string;
  domain: string | null;
  readingTime: number | null;
  isStarred: boolean;
  isArchived: boolean;
  updatedAt: string | null;
  previewImage: string | null;
  tags: { id: number; label: string; slug: string }[];
  onToggleStarred?: () => void;
};

function relativeAge(iso: string | null): string {
  if (!iso) return "";
  const dt = new Date(iso).getTime();
  if (Number.isNaN(dt)) return "";
  const days = Math.floor((Date.now() - dt) / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

export function ArticleCard(props: ArticleCardProps) {
  const meta = [props.domain, props.readingTime ? `${props.readingTime} min` : null, relativeAge(props.updatedAt)]
    .filter(Boolean)
    .join(" · ");
  return (
    <Link href={`/(app)/article/${props.id}`} asChild>
      <Pressable
        accessibilityRole="button"
        className="border-b border-border px-6 py-4 active:bg-surface-2"
      >
        <View className="flex-row gap-4">
          <View className="flex-1">
            <Text
              numberOfLines={2}
              className="font-display text-fg text-lg leading-tight mb-1"
            >
              {props.title ?? props.url}
            </Text>
            <Text className="text-subtle text-xs mb-2">{meta}</Text>
            {props.tags.length > 0 ? (
              <View className="flex-row flex-wrap">
                {props.tags.slice(0, 4).map((t) => (
                  <TagChip key={t.id} label={t.label} />
                ))}
              </View>
            ) : null}
          </View>
          {props.isStarred ? (
            <Text className="text-accent text-sm" accessibilityLabel="starred">
              ★
            </Text>
          ) : null}
        </View>
      </Pressable>
    </Link>
  );
}
```

- [ ] **Step 3: Failing UI test** at `tests/ui/article-card.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react-native";
import { describe, it, expect, vi } from "vitest";

vi.mock("expo-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { ArticleCard } from "@/components/ArticleCard";

describe("ArticleCard", () => {
  it("renders title, domain, and tags", () => {
    render(
      <ArticleCard
        id={1}
        title="Hello world"
        url="https://example.com/x"
        domain="example.com"
        readingTime={5}
        isStarred={false}
        isArchived={false}
        updatedAt={new Date().toISOString()}
        previewImage={null}
        tags={[{ id: 10, label: "tech", slug: "tech" }]}
      />,
    );
    expect(screen.getByText("Hello world")).toBeTruthy();
    expect(screen.getByText(/example.com/)).toBeTruthy();
    expect(screen.getByText("tech")).toBeTruthy();
  });

  it("renders the star indicator when starred", () => {
    render(
      <ArticleCard
        id={1}
        title="x"
        url="https://x"
        domain="x"
        readingTime={null}
        isStarred={true}
        isArchived={false}
        updatedAt={null}
        previewImage={null}
        tags={[]}
      />,
    );
    expect(screen.getByLabelText("starred")).toBeTruthy();
  });

  it("falls back to URL when title is null", () => {
    render(
      <ArticleCard
        id={1}
        title={null}
        url="https://example.com/x"
        domain="example.com"
        readingTime={null}
        isStarred={false}
        isArchived={false}
        updatedAt={null}
        previewImage={null}
        tags={[]}
      />,
    );
    expect(screen.getByText("https://example.com/x")).toBeTruthy();
  });
});
```

- [ ] **Step 4: Run tests** — expect 3 passed.

- [ ] **Step 5: Commit**:

```
feat(ui): ArticleCard + TagChip components
```

---

## Task 7: EmptyState + LibraryHeader components

**Files:** Create `src/components/EmptyState.tsx`, `src/components/LibraryHeader.tsx`.

- [ ] **Step 1: Implement `src/components/EmptyState.tsx`**:

```tsx
import { Text, View } from "react-native";

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <View className="flex-1 items-center justify-center px-12 py-24">
      <Text className="font-display text-fg text-2xl text-center mb-2">{title}</Text>
      {description ? (
        <Text className="text-muted text-sm text-center max-w-sm">{description}</Text>
      ) : null}
    </View>
  );
}
```

- [ ] **Step 2: Implement `src/components/LibraryHeader.tsx`**:

```tsx
import { Text, View } from "react-native";

export function LibraryHeader({
  title,
  count,
}: {
  title: string;
  count?: number;
}) {
  return (
    <View className="px-6 pt-12 pb-3 border-b border-border">
      <View className="flex-row items-baseline justify-between">
        <Text className="font-display text-fg text-3xl">{title}</Text>
        {typeof count === "number" ? (
          <Text className="text-muted text-sm tabular-nums">{count}</Text>
        ) : null}
      </View>
    </View>
  );
}
```

- [ ] **Step 3: Verify** `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm format:check`.

- [ ] **Step 4: Commit**:

```
feat(ui): EmptyState + LibraryHeader components
```

---

## Task 8: ArticleList component (virtualized + pull-to-refresh)

**Files:** Create `src/components/ArticleList.tsx`. Install `@shopify/flash-list`.

- [ ] **Step 1: Install**:

```bash
pnpm add @shopify/flash-list
```

- [ ] **Step 2: Implement `src/components/ArticleList.tsx`**:

```tsx
import { FlashList } from "@shopify/flash-list";
import { ActivityIndicator, RefreshControl, View } from "react-native";
import { ArticleCard } from "./ArticleCard";
import { EmptyState } from "./EmptyState";
import type { ArticleListItem } from "@/hooks/useArticles";

export type ArticleListProps = {
  articles: readonly ArticleListItem[];
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  emptyTitle: string;
  emptyDescription?: string;
};

export function ArticleList({
  articles,
  loading,
  refreshing,
  onRefresh,
  emptyTitle,
  emptyDescription,
}: ArticleListProps) {
  if (loading && articles.length === 0) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator />
      </View>
    );
  }
  if (articles.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }
  return (
    <FlashList
      data={articles}
      keyExtractor={(it) => String(it.id)}
      renderItem={({ item }) => (
        <ArticleCard
          id={item.id}
          title={item.title}
          url={item.url}
          domain={item.domain_name}
          readingTime={item.reading_time}
          isStarred={item.is_starred === 1}
          isArchived={item.is_archived === 1}
          updatedAt={item.updated_at}
          previewImage={item.preview_picture}
          tags={item.tags}
        />
      )}
      estimatedItemSize={88}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    />
  );
}
```

- [ ] **Step 3: Verify** `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm format:check`. Build smoke: `pnpm exec expo export --platform web --output-dir /tmp/smoke && rm -rf /tmp/smoke`.

- [ ] **Step 4: Commit**:

```
feat(ui): ArticleList virtualized list with pull-to-refresh
```

---

## Task 9: Library shell + Unread filter route

**Files:** Create `app/(app)/(library)/_layout.tsx`, `app/(app)/(library)/index.tsx`. Move existing `app/(app)/index.tsx` content into the (library) group as Unread (or delete the existing placeholder).

- [ ] **Step 1: Read** `app/(app)/index.tsx` and `app/(app)/_layout.tsx`. The old placeholder home will be replaced by the library — first delete `app/(app)/index.tsx` (it will become `app/(app)/(library)/index.tsx`).

- [ ] **Step 2: Create** `app/(app)/(library)/_layout.tsx`:

```tsx
import { Slot } from "expo-router";
import { View } from "react-native";

export default function LibraryLayout() {
  return (
    <View className="flex-1 bg-bg">
      <Slot />
    </View>
  );
}
```

- [ ] **Step 3: Create** `app/(app)/(library)/index.tsx` (Unread route):

```tsx
import { useState } from "react";
import { View } from "react-native";
import { LibraryHeader } from "@/components/LibraryHeader";
import { ArticleList } from "@/components/ArticleList";
import { useArticles } from "@/hooks/useArticles";
import { useSyncNow } from "@/hooks/useSyncNow";

export default function UnreadRoute() {
  const articles = useArticles("unread");
  const sync = useSyncNow();
  const [pulling, setPulling] = useState(false);
  const onRefresh = async () => {
    setPulling(true);
    try {
      await sync.mutateAsync();
    } finally {
      setPulling(false);
    }
  };
  return (
    <View className="flex-1">
      <LibraryHeader title="Unread" count={articles.data?.length} />
      <ArticleList
        articles={articles.data ?? []}
        loading={articles.isLoading}
        refreshing={pulling}
        onRefresh={onRefresh}
        emptyTitle="No unread articles"
        emptyDescription="Articles you save show up here. Pull down to sync."
      />
    </View>
  );
}
```

- [ ] **Step 4: Verify** `pnpm exec expo export --platform web --output-dir /tmp/smoke` succeeds. Run all four checks.

- [ ] **Step 5: Commit**:

```
feat(library): library shell + Unread route
```

---

## Task 10: Filter routes (Starred, Archive, All)

**Files:** Create `app/(app)/(library)/starred.tsx`, `app/(app)/(library)/archive.tsx`, `app/(app)/(library)/all.tsx`.

Each is a near-clone of `index.tsx` with a different `useArticles(filter)` and header. Keep them separate files so the routes stay file-based.

- [ ] **Step 1: Create `app/(app)/(library)/starred.tsx`**:

```tsx
import { useState } from "react";
import { View } from "react-native";
import { LibraryHeader } from "@/components/LibraryHeader";
import { ArticleList } from "@/components/ArticleList";
import { useArticles } from "@/hooks/useArticles";
import { useSyncNow } from "@/hooks/useSyncNow";

export default function StarredRoute() {
  const articles = useArticles("starred");
  const sync = useSyncNow();
  const [pulling, setPulling] = useState(false);
  const onRefresh = async () => {
    setPulling(true);
    try {
      await sync.mutateAsync();
    } finally {
      setPulling(false);
    }
  };
  return (
    <View className="flex-1">
      <LibraryHeader title="Starred" count={articles.data?.length} />
      <ArticleList
        articles={articles.data ?? []}
        loading={articles.isLoading}
        refreshing={pulling}
        onRefresh={onRefresh}
        emptyTitle="Nothing starred"
        emptyDescription="Tap the star on any article to bookmark it."
      />
    </View>
  );
}
```

- [ ] **Step 2: Create `app/(app)/(library)/archive.tsx`** (same shape, filter `"archive"`, title "Archive", empty title "Empty archive", description "Archived articles live here so you remember they're done.").

- [ ] **Step 3: Create `app/(app)/(library)/all.tsx`** (filter `"all"`, title "All", empty title "Library is empty", description "Save your first article from your wallabag server, then sync.").

(Use the same template as starred.tsx — repeat the code, do not factor it out yet; Phase 4 may need different per-route behavior.)

- [ ] **Step 4: Verify** all four checks + web export.

- [ ] **Step 5: Commit**:

```
feat(library): Starred / Archive / All filter routes
```

---

## Task 11: Tag filter route

**Files:** Create `app/(app)/(library)/tags/[tag].tsx`.

This route filters articles by a tag slug. Implement a small repo helper `articlesByTagSlug` rather than overloading `useArticles`.

- [ ] **Step 1: Add `articlesByTagSlug`** to `src/db/repos/articles.ts`. Read the file first; append:

```ts
export async function articlesByTagSlug(db: DbDriver, slug: string): Promise<ArticleRow[]> {
  return db.all<ArticleRow>(
    `SELECT ${COLS.map((c) => "a." + c).join(", ")}
     FROM articles a
     JOIN article_tags at ON at.article_id = a.id
     JOIN tags t ON t.id = at.tag_id
     WHERE t.slug = ?
     ORDER BY a.updated_at DESC
     LIMIT 200`,
    [slug],
  );
}
```

- [ ] **Step 2: Add a hook** at `src/hooks/useArticlesByTag.ts`:

```ts
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { articlesByTagSlug } from "@/db/repos/articles";
import { tagsForArticle } from "@/db/repos/tags";
import { getDb } from "@/db";
import { dataEvents } from "@/sync/events";

export function useArticlesByTag(slug: string) {
  const qc = useQueryClient();
  useEffect(() => {
    return dataEvents.subscribe((e) => {
      if (e.kind === "articles" || e.kind === "tags") {
        qc.invalidateQueries({ queryKey: ["articles-by-tag", slug] });
      }
    });
  }, [qc, slug]);
  return useQuery({
    queryKey: ["articles-by-tag", slug],
    queryFn: async () => {
      const db = await getDb();
      const rows = await articlesByTagSlug(db, slug);
      return Promise.all(
        rows.map(async (r) => ({ ...r, tags: await tagsForArticle(db, r.id) })),
      );
    },
    staleTime: 5_000,
  });
}
```

- [ ] **Step 3: Create `app/(app)/(library)/tags/[tag].tsx`**:

```tsx
import { useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { LibraryHeader } from "@/components/LibraryHeader";
import { ArticleList } from "@/components/ArticleList";
import { useArticlesByTag } from "@/hooks/useArticlesByTag";
import { useSyncNow } from "@/hooks/useSyncNow";

export default function TagRoute() {
  const { tag } = useLocalSearchParams<{ tag: string }>();
  const slug = (tag ?? "").toString();
  const articles = useArticlesByTag(slug);
  const sync = useSyncNow();
  const [pulling, setPulling] = useState(false);
  const onRefresh = async () => {
    setPulling(true);
    try {
      await sync.mutateAsync();
    } finally {
      setPulling(false);
    }
  };
  return (
    <View className="flex-1">
      <LibraryHeader title={`#${slug}`} count={articles.data?.length} />
      <ArticleList
        articles={articles.data ?? []}
        loading={articles.isLoading}
        refreshing={pulling}
        onRefresh={onRefresh}
        emptyTitle={`Nothing tagged #${slug}`}
        emptyDescription="Tagged articles will appear here."
      />
    </View>
  );
}
```

- [ ] **Step 4: Verify** all four checks + web export.

- [ ] **Step 5: Commit**:

```
feat(library): tag filter route at /(library)/tags/[tag]
```

---

## Task 12: Search route

**Files:** Create `app/(app)/(library)/search.tsx`.

- [ ] **Step 1: Implement** `app/(app)/(library)/search.tsx`:

```tsx
import { useState } from "react";
import { TextInput, View } from "react-native";
import { ArticleList } from "@/components/ArticleList";
import { LibraryHeader } from "@/components/LibraryHeader";
import { useSearchArticles } from "@/hooks/useSearchArticles";
import { useSyncNow } from "@/hooks/useSyncNow";

export default function SearchRoute() {
  const [query, setQuery] = useState("");
  const search = useSearchArticles(query);
  const sync = useSyncNow();
  const [pulling, setPulling] = useState(false);
  const onRefresh = async () => {
    setPulling(true);
    try {
      await sync.mutateAsync();
    } finally {
      setPulling(false);
    }
  };
  return (
    <View className="flex-1">
      <LibraryHeader title="Search" count={search.data?.length} />
      <View className="px-6 py-3 border-b border-border">
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search title, body, URL..."
          placeholderTextColor="#888"
          autoCapitalize="none"
          autoCorrect={false}
          className="border border-border bg-surface text-fg rounded-md px-3 py-2"
        />
      </View>
      <ArticleList
        articles={search.data ?? []}
        loading={search.isLoading && query.trim().length > 0}
        refreshing={pulling}
        onRefresh={onRefresh}
        emptyTitle={query.trim().length === 0 ? "Search your library" : "No matches"}
        emptyDescription={
          query.trim().length === 0
            ? "Type above to search article titles, content, and URLs."
            : "Try a shorter or simpler query."
        }
      />
    </View>
  );
}
```

- [ ] **Step 2: Verify** all four checks + web export.

- [ ] **Step 3: Commit**:

```
feat(library): search route backed by FTS5
```

---

## Task 13: Article placeholder route

**Files:** Create `app/(app)/article/[id].tsx`. Phase 4 will rewrite this.

- [ ] **Step 1: Implement** `app/(app)/article/[id].tsx`:

```tsx
import { Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useArticle } from "@/hooks/useArticle";

export default function ArticlePlaceholder() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const articleId = Number(id);
  const article = useArticle(articleId);

  return (
    <ScrollView className="flex-1 bg-bg">
      <View className="px-6 pt-12 pb-3 border-b border-border flex-row items-center gap-3">
        <Pressable accessibilityRole="button" onPress={() => router.back()}>
          <Text className="text-accent text-base">← Back</Text>
        </Pressable>
      </View>
      <View className="px-6 py-8">
        <Text className="font-display text-fg text-3xl mb-3">
          {article.data?.title ?? article.data?.url ?? "Loading..."}
        </Text>
        <Text className="text-muted text-sm mb-6">{article.data?.url}</Text>
        <Text className="text-fg text-sm">
          The reader is coming in Phase 4. For now this is a placeholder showing the
          article title and URL. Tap Back to return to the library.
        </Text>
      </View>
    </ScrollView>
  );
}
```

- [ ] **Step 2: Verify** all four checks + web export.

- [ ] **Step 3: Commit**:

```
feat(library): article placeholder route (Phase 4 will fill in the reader)
```

---

## Task 14: Bottom tab bar (phone) + responsive (app) layout

**Files:** Create `src/components/TabBar.tsx`, `src/hooks/useResponsive.ts`. Modify `app/(app)/_layout.tsx`.

- [ ] **Step 1: Implement `src/hooks/useResponsive.ts`**:

```ts
import { useWindowDimensions } from "react-native";

export type Breakpoint = "phone" | "tablet" | "desktop";

export function useBreakpoint(): Breakpoint {
  const { width } = useWindowDimensions();
  if (width >= 1280) return "desktop";
  if (width >= 768) return "tablet";
  return "phone";
}
```

- [ ] **Step 2: Implement `src/components/TabBar.tsx`**:

```tsx
import { Pressable, Text, View } from "react-native";
import { useRouter, useSegments } from "expo-router";

const TABS = [
  { route: "/(app)/(library)", label: "Library", segment: "(library)" },
  { route: "/(app)/(library)/search", label: "Search", segment: "search" },
  { route: "/(app)/settings", label: "Settings", segment: "settings" },
] as const;

export function TabBar() {
  const router = useRouter();
  const segments = useSegments();
  return (
    <View className="flex-row border-t border-border bg-surface">
      {TABS.map((tab) => {
        const isActive =
          (tab.segment === "(library)" && segments.includes("(library)") && !segments.includes("search")) ||
          segments.includes(tab.segment);
        return (
          <Pressable
            key={tab.label}
            accessibilityRole="button"
            onPress={() => router.replace(tab.route)}
            className="flex-1 items-center py-3"
          >
            <Text
              className={isActive ? "text-accent text-sm font-medium" : "text-muted text-sm"}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
```

- [ ] **Step 3: Modify `app/(app)/_layout.tsx`** to render TabBar on phone and hide it inside `/article/:id`. Read the existing file first; replace it with:

```tsx
import { Slot, useSegments } from "expo-router";
import { View } from "react-native";
import { TabBar } from "@/components/TabBar";
import { useBreakpoint } from "@/hooks/useResponsive";

export default function AppLayout() {
  const breakpoint = useBreakpoint();
  const segments = useSegments();
  const inArticle = segments.includes("article");
  const showTabBar = breakpoint === "phone" && !inArticle;
  return (
    <View className="flex-1 bg-bg">
      <View className="flex-1">
        <Slot />
      </View>
      {showTabBar ? <TabBar /> : null}
    </View>
  );
}
```

- [ ] **Step 4: Verify** all four checks + web export. Confirm the web bundle still builds.

- [ ] **Step 5: Commit**:

```
feat(library): phone bottom tab bar with responsive hiding on article + desktop
```

---

## Task 15: Desktop rail

**Files:** Create `src/components/Rail.tsx`. Modify `app/(app)/(library)/_layout.tsx` to render the rail on tablet+.

- [ ] **Step 1: Implement `src/components/Rail.tsx`**:

```tsx
import { Pressable, ScrollView, Text, View } from "react-native";
import { Link, useSegments } from "expo-router";
import { useTags } from "@/hooks/useTags";

const FILTERS = [
  { route: "/(app)/(library)", label: "Unread", segment: "index" },
  { route: "/(app)/(library)/starred", label: "Starred", segment: "starred" },
  { route: "/(app)/(library)/archive", label: "Archive", segment: "archive" },
  { route: "/(app)/(library)/all", label: "All", segment: "all" },
] as const;

export function Rail() {
  const segments = useSegments();
  const tags = useTags();

  return (
    <ScrollView className="bg-bg" contentContainerClassName="px-6 py-8">
      <View className="mb-6">
        <Text className="font-mono text-subtle uppercase text-[10px] tracking-widest mb-2 px-2">
          Library
        </Text>
        {FILTERS.map((f) => {
          const isActive =
            (f.segment === "index" && segments[segments.length - 1] === "(library)") ||
            segments.includes(f.segment);
          return (
            <Link key={f.label} href={f.route} asChild>
              <Pressable
                className={`px-2 py-1.5 rounded-md ${isActive ? "bg-accent-soft" : ""}`}
              >
                <Text
                  className={
                    isActive
                      ? "text-accent-ink text-sm font-medium"
                      : "text-fg text-sm"
                  }
                >
                  {f.label}
                </Text>
              </Pressable>
            </Link>
          );
        })}
      </View>
      <View>
        <Text className="font-mono text-subtle uppercase text-[10px] tracking-widest mb-2 px-2">
          Tags
        </Text>
        {(tags.data ?? []).slice(0, 30).map((t) => {
          const isActive = segments.includes(t.slug);
          return (
            <Link key={t.id} href={`/(app)/(library)/tags/${t.slug}`} asChild>
              <Pressable
                className={`px-2 py-1.5 rounded-md ${isActive ? "bg-accent-soft" : ""}`}
              >
                <Text
                  className={
                    isActive
                      ? "text-accent-ink text-sm"
                      : "text-fg text-sm"
                  }
                >
                  #{t.label}
                </Text>
              </Pressable>
            </Link>
          );
        })}
      </View>
    </ScrollView>
  );
}
```

- [ ] **Step 2: Modify `app/(app)/(library)/_layout.tsx`** to render rail on tablet+:

```tsx
import { Slot } from "expo-router";
import { View } from "react-native";
import { Rail } from "@/components/Rail";
import { useBreakpoint } from "@/hooks/useResponsive";

export default function LibraryLayout() {
  const breakpoint = useBreakpoint();
  const showRail = breakpoint !== "phone";
  return (
    <View className="flex-1 bg-bg flex-row">
      {showRail ? (
        <View className="w-[240px] border-r border-border">
          <Rail />
        </View>
      ) : null}
      <View className="flex-1">
        <Slot />
      </View>
    </View>
  );
}
```

- [ ] **Step 3: Verify** all four checks + web export.

- [ ] **Step 4: Commit**:

```
feat(library): desktop rail with filters + tag list
```

---

## Task 16: Settings expansion (sync info + manual sync)

**Files:** Modify `app/(app)/settings.tsx`. Read the existing file first.

Add a "Sync" section with last-sync timestamp + a "Sync now" button.

- [ ] **Step 1: Replace `app/(app)/settings.tsx`** with:

```tsx
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/hooks/useAuth";
import { signOut } from "@/auth/state";
import { useSyncStatus } from "@/hooks/useSyncStatus";
import { useSyncNow } from "@/hooks/useSyncNow";

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "never";
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function Settings() {
  const auth = useAuth();
  const router = useRouter();
  const status = useSyncStatus();
  const sync = useSyncNow();
  const [signingOut, setSigningOut] = useState(false);

  const onSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      router.replace("/(auth)/server");
    } finally {
      setSigningOut(false);
    }
  };

  const host = auth.status === "authenticated" ? new URL(auth.serverUrl).host : "—";

  return (
    <View className="flex-1 bg-bg px-6 pt-16">
      <Text className="font-display text-fg text-3xl mb-6">Settings</Text>

      <Section title="Account">
        <Row label="Server" value={host} />
      </Section>

      <Section title="Sync">
        <Row label="Last sync" value={relativeTime(status.data?.lastFullSyncAt ?? null)} />
        <Pressable
          accessibilityRole="button"
          disabled={sync.isPending}
          onPress={() => sync.mutate()}
          className="px-4 py-3 border-t border-border"
        >
          {sync.isPending ? (
            <ActivityIndicator />
          ) : (
            <Text className="text-accent text-sm">Sync now</Text>
          )}
        </Pressable>
      </Section>

      <Pressable
        accessibilityRole="button"
        disabled={signingOut}
        onPress={onSignOut}
        className="border border-border bg-surface rounded-md py-3 items-center mt-8"
      >
        {signingOut ? <ActivityIndicator /> : <Text className="text-accent">Sign out</Text>}
      </Pressable>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mb-6">
      <Text className="font-mono text-subtle uppercase text-xs tracking-widest mb-2">{title}</Text>
      <View className="border border-border bg-surface rounded-md">{children}</View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between px-4 py-3 border-b border-border last:border-0">
      <Text className="text-muted text-sm">{label}</Text>
      <Text className="text-fg text-sm">{value}</Text>
    </View>
  );
}
```

- [ ] **Step 2: Verify** all four checks + web export.

- [ ] **Step 3: Commit**:

```
feat(settings): sync section with last-sync time + manual sync button
```

---

## Task 17: README + Phase 3 close

**Files:** Modify `README.md`. Replace the `## Status` section.

- [ ] **Step 1: Update `## Status`**:

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

Phase 3 (Library UI) complete:
- Filter routes: Unread / Starred / Archive / All / Tag
- Full-text search via SQLite FTS5
- Virtualized article list with pull-to-refresh
- Optimistic mutations: toggle starred / archive, delete
- Auto initial sync after sign-in + incremental sync on app foreground
- Phone bottom tab bar; tablet/desktop rail with filters + tag list
- Settings: account info, last-sync time, manual Sync now
- Article placeholder route (reader arrives in Phase 4)

Reader, share targets, and release pipeline arrive in later phases.
```

- [ ] **Step 2: Commit**:

```
docs: README for Phase 3
```

---

## Self-review

**Spec coverage check (Phase 3 scope):**

| Spec section | Covered by |
|---|---|
| §7.1 Responsive layout (phone / tablet / desktop) | Tasks 14, 15 |
| §7.2 Routes: filter routes, tags, search, settings, article | Tasks 9, 10, 11, 12, 13 |
| §7.3 Library shell components (rail, list, header) | Tasks 6, 7, 8, 15 |
| §7.4 Search (FTS5 first) | Tasks 1, 2, 4, 12 |
| §7.5 Settings expansion | Task 16 |
| §6 Optimistic mutations + outbox enqueue | Task 3 |
| Auto-sync on launch + foreground | Task 5 |

**Out of scope by design:**
- Meta pane (third column on desktop) → Phase 4 (alongside reader)
- Article body rendering / annotations → Phase 4
- Add-by-URL UI → Phase 5 (with share extensions)
- Image cache → Phase 4

**Placeholder scan:** No "TBD" / "TODO" / "implement later". Each step has actual code or actual commands.

**Type consistency:**
- `ArticleListItem` (defined in Phase 2's `useArticles`) is consumed by `ArticleList` in Task 8.
- `Filter` type (Phase 2 articles repo) consumed by all filter routes (Tasks 9, 10).
- `searchArticles(db, query)` signature (Task 2) consumed by `useSearchArticles` (Task 4) consumed by search route (Task 12).
- `articlesByTagSlug(db, slug)` (Task 11 step 1) consumed by `useArticlesByTag` (Task 11 step 2) consumed by tag route (Task 11 step 3).
- `useBreakpoint()` (Task 14) consumed by Tasks 14 and 15.
- Mutation hook actions (`toggleStarredAction`, `toggleArchivedAction`, `deleteArticleAction`) defined in Task 3 — exposed but not yet called from any UI in Phase 3 (the wiring will happen on the article-detail screen in Phase 4 and via long-press in a future polish pass; this is acceptable for Phase 3).

**Notable scope simplification flagged:** Phase 3 does not yet wire mutation hooks into the ArticleCard's UI (no swipe-to-archive, no long-press star). The hooks exist and are unit-tested; the UI affordances will land alongside the reader's action bar in Phase 4 (where the same affordances need to live anyway). The deferral is documented here so future readers don't expect them.
