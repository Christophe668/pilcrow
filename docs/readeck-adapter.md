# Multi-backend support: Wallabag + Readeck

This document captures the design decisions for making pilcrow speak two
backends — Wallabag (current) and [Readeck](https://codeberg.org/readeck/readeck) —
behind a single mobile UI. It is kept in-tree so the plan survives across
sessions.

## Why both

Wallabag has a mature ecosystem and several existing mobile clients; Readeck
is a younger, more lightweight project (single Go binary, SQLite-only) with
**no native mobile app**. Pilcrow can fill that gap without abandoning its
Wallabag users by exposing both backends behind one app.

The Readeck adapter is not just feature parity — Readeck's API is in some
respects richer than Wallabag's, so adopting it improves pilcrow's offline
sync and content handling.

## API differences that drive the design

| Concern | Wallabag | Readeck |
|---|---|---|
| Auth | OAuth2 password grant + refresh, client_id/secret | OAuth 2.0 with **PKCE** or **device code** flow, dynamic client registration (RFC 7591) |
| IDs | numeric (`id: number`) | `short-uid` strings |
| List envelope | HAL `{ page, pages, _embedded.items }` | flat array, pagination via Link headers |
| Article paths | `/api/entries.json` | `/api/bookmarks` |
| Update verbs | PATCH `archive`/`starred` ints | PATCH `is_archived`/`is_marked` booleans |
| Tags / labels | objects `{id, label, slug}` | bare strings (no IDs) |
| Article HTML | inline in `content` field | separate `resources.article.src` URL (lazy fetch) |
| Incremental sync | `since=<unix>` (no delete signal) | dedicated `/bookmarks/sync?since=<rfc3339>` returns `{id, time, type: "update"\|"delete"}` |
| Read progress | local-only (pilcrow's `scroll_position`) | server-side `read_progress: 0-100` |
| Document type | none | `type: article\|photo\|video` |
| Extraction state | inferred from empty `content` | explicit `state: 0\|1\|2` + `loaded: bool` |
| Annotations | DOM XPath ranges (multiple per highlight) | text-offset based (single locator) |

## Three things Readeck gives us that Wallabag does not

1. **Delete signals via `/bookmarks/sync`.** Wallabag's `since` parameter
   doesn't tell pilcrow about server-side deletions, so deleted articles
   stay in the local cache until the user notices. Readeck's sync endpoint
   returns explicit `{type: "delete"}` rows. Pilcrow's sync engine should
   process these for the Readeck adapter, and we should consider a periodic
   "verify-and-prune" pass for Wallabag where pilcrow asks about specific
   IDs to detect deletions.

2. **Server-side read progress.** Pilcrow currently tracks
   `scroll_position` per article in local SQLite only. Readeck stores
   `read_progress` (0–100 int) server-side, which means cross-device sync.
   The `Article` type should grow `readProgress: number | null`; Wallabag
   adapter sets null and pilcrow falls back to the local column.

3. **Document type discrimination.** `type: photo|video` lets pilcrow
   render a photo bookmark as an image gallery and a video bookmark with
   an embedded player, instead of dumping a "no readable content" page.
   The `Article` type should grow `documentType: "article" | "photo" |
   "video"`; Wallabag adapter defaults to `"article"`.

## Schema design (PR 3)

The naive approach — migrate all `id` columns to `TEXT` — breaks the
existing FTS5 virtual table, which uses `articles.id` as
`content_rowid` (FTS5 requires INTEGER rowid).

**Adopted approach: keep local INTEGER PKs, add a `backend_id TEXT`
column.**

```sql
ALTER TABLE articles    ADD COLUMN backend_id TEXT;
ALTER TABLE tags        ADD COLUMN backend_id TEXT;
ALTER TABLE annotations ADD COLUMN backend_id TEXT;

-- Backfill: existing Wallabag rows have integer IDs that map cleanly to strings.
UPDATE articles    SET backend_id = CAST(id AS TEXT);
UPDATE tags        SET backend_id = CAST(id AS TEXT);
UPDATE annotations SET backend_id = CAST(id AS TEXT);

CREATE UNIQUE INDEX idx_articles_backend_id    ON articles(backend_id);
CREATE UNIQUE INDEX idx_tags_backend_id        ON tags(backend_id);
CREATE UNIQUE INDEX idx_annotations_backend_id ON annotations(backend_id);
```

Local PK (INTEGER, autoincrement for new rows) stays the FTS rowid and the
FK target. Backend ID (TEXT) is what the sync engine resolves against when
processing `/bookmarks` payloads or `/bookmarks/sync` deltas. The
`Number(article.id)` casts in [src/sync/engine.ts](../src/sync/engine.ts)
and the hooks go away — they're replaced by `findByBackendId(backend_id)`
calls.

The outbox payloads stay numeric (local PKs) and translate to backend IDs
at the call boundary in [src/sync/outbox-drainer.ts](../src/sync/outbox-drainer.ts).

For multi-account support later, `backend_id` would be paired with a
`server_id` foreign key (one row per `(server_id, backend_id)`). That's
out of scope for now; we'll only support one active backend at a time.

## Auth design (PR 4)

The `Backend.signIn(credentials)` shape needs to support two grant
families:

```ts
type SignInCredentials =
  | { kind: "wallabag"; serverUrl: string; clientId: string;
      clientSecret: string; username: string; password: string }
  | { kind: "readeck-device"; serverUrl: string; clientId: string };

type SignInResult =
  | { kind: "session"; session: Session }
  | { kind: "device-code-pending"; userCode: string; verificationUri: string;
      pollIntervalSeconds: number; deviceCode: string };
```

**Wallabag** signs in synchronously (one POST → tokens).

**Readeck** uses the device code flow:

1. App calls `POST /oauth/client` once on first run to register itself
   (RFC 7591). Stores the returned `client_id` per server.
2. Sign-in: app calls `POST /oauth/device` with `client_id` + scope. Gets
   `device_code` + `user_code` + `verification_uri`.
3. UI shows the user code and the URL ("go to readeck.example.com/oauth/device,
   type ABCD-1234"). User authorizes via web.
4. App polls `POST /oauth/token` with `grant_type=urn:ietf:params:oauth:grant-type:device_code`
   until it gets `200` (token issued) instead of `400 authorization_pending`.
5. Token is stored in secure storage; subsequent requests use `Authorization: Bearer <token>`.

This is **better UX than Wallabag's password grant** — the user never types
their password into pilcrow.

The sign-in screen needs a server-kind picker (probe `/api` to detect
backend, or have user choose). On detection failure, default to a manual
toggle.

## Adapter design (PR 5)

```
src/api/
  backend/
    index.ts            ← getBackend(): Backend (dispatches on stored kind)
    types.ts            ← Backend interface, Article, etc.
    wallabag.ts         ← WallabagBackend (existing, refactored)
    readeck.ts          ← ReadeckBackend (new)
    readeck-auth.ts     ← OAuth device flow helper
```

### ReadeckBackend translation rules

| Operation | Readeck call | Notes |
|---|---|---|
| `listArticles` | `GET /bookmarks?limit=...&page=...` | Page metadata read from `Total-Count` / `Current-Page` headers. |
| `getArticle` | `GET /bookmarks/{id}` then `GET resources.article.src` | Two-call: metadata, then HTML. Cache HTML in `articles.content`. |
| `createArticle` | `POST /bookmarks` | Returns `202` with `Bookmark-Id` header — extraction is async. Adapter polls `GET /bookmarks/{id}` until `loaded: true`, with a timeout. |
| `patchArticle` | `PATCH /bookmarks/{id}` | Body uses `is_archived` / `is_marked` booleans natively. `tagLabels` → `labels`. |
| `deleteArticle` | `DELETE /bookmarks/{id}` | |
| `reloadArticle` | not supported | Capability flag `reloadArticle: false`; UI hides the button. |
| `listTags` | `GET /bookmarks/labels` | Returns `[{name, count}]`. Adapter synthesizes IDs as `slug = name`, `id = name`. |
| `addTagsToArticle` | `PATCH /bookmarks/{id}` with `add_labels: [...]` | |
| `removeTagFromArticle` | `PATCH /bookmarks/{id}` with `remove_labels: [...]` | TagId is the label string. |
| `listAnnotations` | `GET /bookmarks/{id}/annotations` | Locator is text-offset based. |
| `createAnnotation` | `POST /bookmarks/{id}/annotations` | Single locator only — adapter rejects multi-locator inputs (no Wallabag round-trip use case). |

### Incremental sync (Readeck-specific)

The Readeck adapter overrides the sync engine's strategy: instead of
paginating `/bookmarks` with a `since` filter, it calls `/bookmarks/sync?since=...`
to get `{id, time, type}` rows, processes deletions locally, and fetches
full data only for IDs flagged as `update`.

This reduces bandwidth dramatically (a sync that finds nothing changed is
a single empty array response) and gives pilcrow the deletion signal it
currently lacks.

## Stage map

1. **PR #1 (landed)**: Backend interface + WallabagBackend adapter (no behavior change).
2. **PR #2 (this doc)**: Design note.
3. **PR #3**: Schema migration — `backend_id` columns, repos rewritten, sync engine resolves by backend_id, `Number(id)` casts dropped.
4. **PR #4**: Generalize sign-in. New `SignInResult` discriminated union supports device-code flow. Auth state machine handles the polling phase. Wallabag continues to work unchanged.
5. **PR #5**: ReadeckBackend implementation. Server-kind picker on the sign-in screen. Backend factory dispatches by stored kind. Tested against a local Readeck Docker container.
6. **PR #6**: Polish. Plumb `readProgress` and `documentType` through to the reader UI. Photo / video rendering. Capability-driven UI affordances (hide reload button for Readeck, hide tag color picker if Readeck doesn't support it, etc.).

## Risks and unknowns

- **OAuth client registration on Readeck.** Per-install client_id means each pilcrow install registers itself when first pointing at a server. Need to confirm that re-registration is idempotent on the server, or store the client_id keyed by server URL.
- **Deferred bookmark creation.** Readeck's `POST /bookmarks` returns 202; extraction happens asynchronously. The current sync engine assumes synchronous create. Adapter needs to either poll briefly (UX delay) or return early and rely on the next sync to populate content.
- **Annotation model translation.** Pilcrow's reader builds DOM XPath ranges from a WebView selection. Translating those to text offsets for Readeck (and back, when rendering Readeck's annotations into the WebView) needs design — could be punted to v2 by hiding annotation UI when `capabilities.annotations === false` and treating the Readeck adapter as having limited annotation support initially.
- **FTS rebuild.** Adding a `backend_id` column doesn't disturb FTS, but if we later denormalize anything else into `articles`, the FTS triggers in [002_fts.sql](../src/db/migrations/002_fts.sql) need updating.
