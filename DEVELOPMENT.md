# Development

This is the developer-facing companion to the user [README](README.md). If
you just want to use Pilcrow, start there.

## Develop locally

```bash
pnpm install
pnpm tokens   # generates the colour palette
pnpm web      # or `pnpm ios` / `pnpm android`
pnpm test
```

Other scripts:

| Script              | What it does                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| `pnpm lint`         | ESLint                                                                                            |
| `pnpm typecheck`    | TypeScript, no emit                                                                               |
| `pnpm format`       | Prettier write                                                                                    |
| `pnpm format:check` | Prettier check                                                                                    |
| `pnpm build:web`    | Static web export → `dist/`                                                                       |
| `pnpm test:watch`   | Vitest in watch mode                                                                              |
| `pnpm kobo:install` | rsync `pilcrow.koplugin/` onto a USB-mounted Kobo (set `KOBO_MOUNT=…` to override the mount path) |

## Project layout

This repo is a small monorepo bundling the three pieces of the Pilcrow ecosystem:

- **Expo app** — iOS, Android, and web client
  - `app/` — [Expo Router](https://docs.expo.dev/router/introduction/) routes. The web export at `/` doubles as the landing page; HTML meta lives in [`app/+html.tsx`](app/+html.tsx).
  - `src/` — shared modules (api, auth, db, theme, lib, hooks, sync, reader).
  - `scripts/` — build-time helpers (token generation, dev backend proxy, Kobo install).
  - `tests/` — Vitest unit + UI tests.
- **KOReader plugin** — [`koreader-plugin/pilcrow.koplugin/`](koreader-plugin/pilcrow.koplugin/) — independent Lua plugin for Kobo eink devices.

## Web build & Docker

A static web export and matching `Dockerfile` are included.

```bash
pnpm build:web              # -> ./dist
docker build -t pilcrow-web .
docker run --rm -p 8080:80 pilcrow-web
```

The image is a two-stage build: Node 22 + pnpm produces the static export,
then nginx-alpine serves it. No source or `node_modules` end up in the
runtime image.

The container can run in two modes:

- **Same-origin proxy** (set `PILCROW_BACKEND_URL`) — nginx forwards
  `/api/` and `/oauth/` to the configured backend, no CORS needed.
- **Cross-origin** (no env var) — static site only; browser fetches the
  backend directly, requires CORS headers on the backend.

Full deployment guide including NAS / reverse-proxy setups: [docs/DEPLOY.md](docs/DEPLOY.md).
The nginx config is a template at [`docker/nginx.conf.template`](docker/nginx.conf.template);
the entrypoint at [`docker/entrypoint.sh`](docker/entrypoint.sh) renders
it via `envsubst` and writes `/runtime-config.json` alongside it.

## Backend split

`src/api/backend/` defines a `Backend` interface and ships two adapters
(`wallabag` and `readeck`). The active backend is selected by the user at
sign-in and persisted via the `backend_kind` key; the sync engine and UI
talk only to the interface, never the adapters directly.

Adding a backend means implementing the interface in
[`src/api/backend/types.ts`](src/api/backend/types.ts) and wiring it through
[`src/api/backend/index.ts`](src/api/backend/index.ts).

## Web target gotchas

- **Token storage.** `expo-secure-store` has no native backing on web (SDK 55), so [`src/auth/storage.ts`](src/auth/storage.ts) falls back to `localStorage` under a `wb_` prefix. Document this in any auth refactor.
- **Dev proxy.** Self-hosted Wallabag/Readeck rarely ship CORS headers. [`scripts/dev-backend-proxy.js`](scripts/dev-backend-proxy.js) runs as Metro middleware to forward `/__backend-proxy/*` to the host carried in `x-proxy-target`. It refuses non-loopback callers and is gated behind `Platform.OS === "web" && __DEV__` on the client. It's not bundled into the production export.
- **SQLite.** The web target uses `expo-sqlite`'s WASM build; transactions are serialized through a single-promise queue in [`src/db/driver-expo.ts`](src/db/driver-expo.ts) because the underlying connection doesn't queue concurrent `withTransactionAsync` callers itself.
- **Article rendering.** Web uses a sandboxed `<iframe srcDoc=…>`; native uses `react-native-webview`. Both share the HTML pipeline in [`src/reader/`](src/reader/).

## Tests

Vitest with React Native Testing Library. UI tests stub `react-native` via
`src/test/setup.ts` so component tests run in a Node environment without
needing a simulator.

Some tests use `better-sqlite3` as a synchronous SQLite driver. If you see
`NODE_MODULE_VERSION` errors, run:

```bash
pnpm rebuild better-sqlite3
```

## KOReader plugin

The plugin under [`koreader-plugin/pilcrow.koplugin/`](koreader-plugin/pilcrow.koplugin/)
is licensed AGPL-3.0-or-later (KOReader's license) and developed
independently. See its own [README](koreader-plugin/pilcrow.koplugin/README.md)
and [CHANGELOG](koreader-plugin/pilcrow.koplugin/CHANGELOG.md).

To install onto a USB-mounted Kobo:

```bash
pnpm kobo:install
```

### Cutting a koplugin release

Tag the repo with `koplugin-v<calendar-version>` (e.g. `koplugin-v2026.05.0`).
The [`koplugin.yml`](.github/workflows/koplugin.yml) workflow zips
`pilcrow.koplugin/` and publishes the archive as a GitHub Release asset, so
end users can install without cloning the repo. App and koplugin tags are
disjoint (`v*` vs `koplugin-v*`) because the koplugin uses calendar
versioning while the app uses semver.

## Security

User-facing summary is in the [README](README.md#privacy--security).
Vulnerability disclosure is in [SECURITY.md](SECURITY.md). Internal notes:

- Article HTML is treated as untrusted. The web reader uses an iframe with `sandbox="allow-same-origin allow-scripts"`; the native reader uses `react-native-webview` with `originWhitelist` restricted to the article's own origin.
- OAuth tokens are kept in `expo-secure-store` on native (hardware-backed Keychain/Keystore where available); the web fallback to `localStorage` is documented above.
- The Wallabag OAuth password is sent only to the token endpoint and discarded — never persisted.
- SQL is fully parameterized; column-name interpolation is restricted to fixed allowlists.
