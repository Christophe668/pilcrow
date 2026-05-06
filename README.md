# wallabag — Expo client

Cross-platform Wallabag reader (iOS, Android, web), built with Expo.

## Status

Phase 1 (Foundation) complete:

- Two-step onboarding wizard (server URL + OAuth credentials)
- Token storage and auto-refresh
- Sign-in / sign-out
- Theming (light / dark / sepia / auto)

Library, reader, offline sync, and share targets arrive in later phases.

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
