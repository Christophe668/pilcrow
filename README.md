# Pilcrow — a Wallabag reading client

Cross-platform reader for [Wallabag](https://wallabag.org) (iOS, Android, web), built with Expo.

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
- Full-text search via SQLite FTS5 (LIKE fallback on web)
- Virtualized article list with pull-to-refresh
- Optimistic mutations: toggle starred / archive, delete
- Auto initial sync after sign-in + incremental sync on app foreground
- Phone bottom tab bar; tablet/desktop rail with filters + tag list
- Settings: account info, last-sync time, manual Sync now

Phase 4 (Reader) complete:

- Real article reader: WebView on native, sandboxed iframe on web
- Typography stylesheet matching the prototype (Newsreader serif, paper background)
- Reader prefs sheet: font size, family (serif / sans), theme (light / dark / sepia)
- Image cache: per-article download + LRU eviction on native, network-cached on web
- Lazy fetch of full article content on first open
- Scroll-position resume across opens
- Action bar: star, archive, share, prefs, delete

Phase 5a (Add by URL) complete:

- In-app "Save article" modal at /add with URL + tags fields
- Floating + button on the library; "+" tab in the phone bottom bar
- Web bookmarklet (drag to bookmarks bar) in Settings → Save shortcuts
- Optimistic create via the Phase-2 outbox: appears in the library immediately, server fetches the body in the background

Phase 4b (Annotations) complete:

- Render existing annotations as highlights on article load
- Select text → "Highlight" toolbar → tap to create a new highlight
- Tap a highlight → bottom sheet to read the quote, edit a note, or delete
- All operations optimistic via the Phase-2 outbox; offline-friendly
- XPath range serializer (single-block ranges) — heavily unit-tested

Native share targets (iOS share extension, Android intent filter) and the release pipeline arrive in later phases.

## Develop

```bash
pnpm install
pnpm tokens   # generates the palette
pnpm web      # or `pnpm ios` / `pnpm android`
pnpm test
```

## Project layout

This repo is a small monorepo bundling the three pieces of the Pilcrow ecosystem:

- **Expo app** (this directory) — iOS, Android, and web client
  - `app/` — Expo Router routes (the web export at `/` doubles as the landing page; meta lives in [`app/+html.tsx`](app/+html.tsx))
  - `src/` — shared modules (api, auth, theme, lib, hooks)
  - `scripts/` — build-time helpers
  - `tests/` — Vitest unit + UI tests
- **KOReader plugin** — [`koreader-plugin/pilcrow.koplugin/`](koreader-plugin/pilcrow.koplugin/) — turns the Wallabag unread queue into the primary reading experience on Kobo eink devices. See its [README](koreader-plugin/pilcrow.koplugin/README.md) for install + usage.

## Web build

A static web export and matching `Dockerfile` are included.

```bash
pnpm build:web              # -> ./dist
docker build -t pilcrow-web .
docker run --rm -p 8080:80 pilcrow-web
```

## License

[MIT](LICENSE). The bundled Newsreader font is licensed under the SIL OFL 1.1
(see [`assets/fonts/OFL.txt`](assets/fonts/OFL.txt)).

## Trademarks

Pilcrow is an independent client and is not affiliated with the Wallabag
project. _Wallabag_ is a trademark of its respective owner.
