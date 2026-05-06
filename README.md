# wallabag — Expo client

Cross-platform Wallabag reader (iOS, Android, web), built with Expo.

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

Annotations creation, share targets, and release pipeline arrive in later phases.

## Develop

```bash
pnpm install
pnpm tokens   # generates the palette
pnpm web      # or `pnpm ios` / `pnpm android`
pnpm test
```

## Project layout

- `app/` — Expo Router routes
- `src/` — shared modules (api, auth, theme, lib, hooks)
- `scripts/` — build-time helpers
- `tests/` — Vitest unit + UI tests
- `docs/superpowers/` — design spec and implementation plans

## Reference

The product design is captured in `wallabag-prototype.html` at the repo root.
The full design spec lives at `docs/superpowers/specs/2026-05-06-wallabag-expo-client-design.md`.
