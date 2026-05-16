# Pilcrow

A KOReader plugin that turns your read-it-later queue into the primary reading
experience on Kobo eink devices.

> Licensed under **AGPL-3.0-or-later** (see `LICENSE` in this directory) to
> match the KOReader runtime it links against. The rest of the surrounding
> repository is MIT-licensed and stands on its own.

## Why this exists

KOReader already had a Wallabag plugin and a couple of community attempts at
Readeck integration, but they all stop at the same place: download articles,
let you read them, mark-read on close. That's a transport layer, not a
client. None of them treat the read-it-later queue as the primary surface or
keep the rest of the app's state — tags, search, filters, in-progress
sorting, starring, archiving, **highlights**, **notes** — round-tripping
with the server.

Pilcrow is a full client. The cached queue _is_ your home screen if you want
it to be; you filter by status / tag / search, sort by length or recency,
tap a row to read, and every state change (star, archive, delete, highlight
text, attach a note) syncs back. Highlights you make on the Kobo show up on
the web app and in your Readeck/Wallabag account; highlights from elsewhere
pull down into a Highlights list on the device. The plugin manages its own
EPUB cache, preview images, and reading-progress reset, and switches
between Wallabag and Readeck without losing either backend's state.

It's still a personal project, still rough in places, but the goal was
explicit: stop treating the e-reader as a write-once mirror of the server
and let the device be a real participant in the read-it-later workflow.

## Backends

Pilcrow speaks **Wallabag** (default) and **Readeck**. You pick the backend
in Settings → Backend; switching keeps the two caches and downloaded EPUBs
side-by-side so flipping back and forth is harmless.

- **Wallabag** — credentials are read from the original
  `wallabag.koplugin`'s `wallabag.lua`, so you configure your server once
  and both plugins use it.
- **Readeck** — credentials live in `<settings_dir>/readeck.lua` and can be
  edited from Pilcrow Settings → Readeck server & token. You need the
  server URL and a bearer access token (generate one from your Readeck
  profile → API tokens).

> v1 — minimum-viable shape. See [Not yet](#not-yet) for what's intentionally
> scoped out.

## What it does

- Adds a **Wallabag queue** entry (titled **Readeck** when the Readeck
  backend is selected) to the main menu.
- Optional: opens automatically as the startup screen instead of the file
  manager (toggle in Settings).
- Shows a fullscreen scrollable list of cached articles. Each row is a
  card: thumbnail (preview image) on the left, two-line title, and a meta
  line with `domain · reading time · age`. Unread articles use bold
  titles with a `•` marker; starred articles are prefixed with `★`.
  Articles without a preview picture get a generic placeholder glyph.
- Five articles per page on a Kobo Libra 2 (~250 px / row), comfortably
  above the 88 px touch-target minimum.
- Top-bar menu (tap the hamburger icon): **Sync now**, **Tags**
  (multi-select), **Sort** (Newest / Oldest / Longest / Shortest /
  Domain), **Search** (matches title or domain), **Clear filters**,
  **Settings**.
- A **chip row** under the title bar shows what filters are active:
  - Status chip (always shown) → tap to open a 4-button mini-dialog
    (Unread / Starred / Archived / All).
  - One tag chip per active tag — tap to remove.
  - Search chip when a search term is set — tap to clear.
  - Sort chip when sort ≠ default ("Newest first") — tap to reset.
  - Filter state (status / tags / sort) is persisted across sessions in
    `pilcrow.lua`. Search is session-only.
- **Tap** a row to open the article in the regular reader. If the EPUB hasn't
  been downloaded yet, it's fetched on demand.
- **Long-press** a row for: Mark as read · Star · Delete · Copy URL to
  clipboard.
- When you finish an article (KOReader's `EndOfBook` event), the plugin asks
  once whether to archive it on the server. Choose **Always** or **Never** to
  remember the answer.
- **Offline-first**: the article list is cached as JSON on disk and renders
  with no network. Sync is explicit (the **Sync now** button) or automatic on
  open: when the queue view is launched, the cached list paints
  immediately, then a background sync runs if the _Auto-sync when WiFi is
  on_ toggle is enabled (default ON) and the cache is older than the
  configurable threshold (default 10 min; set to 0 for "every open"). On a
  fresh install the cache is empty, so the first open triggers an immediate
  sync.

## Files

```
plugins/pilcrow.koplugin/
├── _meta.lua            -- plugin metadata
├── main.lua             -- entry point, menu, sync orchestration, finish prompt
├── queueview.lua        -- the article list (Menu:extend) + filter dialogs
├── articlecard.lua      -- card-style row widget (thumbnail + title + meta)
├── articlerow.lua       -- format an article into a Menu item
├── chiprow.lua          -- tappable Chip + wrap-aware ChipRow widgets
├── statusbar.lua        -- text + tappable ↻ sync button below the title bar
├── styles/
│   └── wallabag-code.css -- bundled code-block tweak (see "Code styling")
├── settingsview.lua     -- plugin-local settings (download dir, prompts, etc.)
├── articlecache.lua     -- offline JSON store under <data_dir>/pilcrow/
                            (named to avoid collision with KOReader's frontend/cache.lua)
├── backendclient.lua    -- factory: returns the right client for the configured backend
├── wallabagclient.lua   -- thin REST client; reads creds from wallabag.lua
├── readeckclient.lua    -- thin REST client; reads creds from readeck.lua
├── README.md            -- this file
└── CHANGELOG.md
```

## Install

Two options:

**From a release zip (no laptop required).** Grab the latest
`pilcrow.koplugin-<version>.zip` from the project's
[GitHub Releases](https://github.com/Christophe668/pilcrow/releases?q=koplugin) (look for tags starting with `koplugin-v`),
copy it to the device, and unzip it so the result is
`.adds/koreader/plugins/pilcrow.koplugin/` (Kobo) or the equivalent
`plugins/` directory on your platform.

**From source.**

1. Copy (or symlink) `pilcrow.koplugin/` into your KOReader install's
   `plugins/` directory. Repo contributors can run `pnpm kobo:install`
   from the project root to rsync onto a USB-mounted Kobo.
2. Restart KOReader (or open the plugin manager and re-enable plugins).
3. Configure credentials for the backend you want to use:
   - **Wallabag (default):** open the original Wallabag plugin's settings
     and configure server URL, client id/secret, username, and password.
     Pilcrow reads them from the same `<settings_dir>/wallabag.lua` file.
   - **Readeck:** open Pilcrow → hamburger → Settings, tap **Backend** and
     pick Readeck, then tap **Readeck server & token…** to enter the
     server URL (e.g. `https://readeck.example.com`) and a bearer access
     token from your Readeck profile.
4. Open **Wallabag queue** / **Readeck queue** from the main menu and tap
   the hamburger → **Sync now**.

## Manual test plan

A 10-minute sanity pass before each release.

| #   | Step                                                                             | Expected                                                                                                                                                                        |
| --- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | First-run: enable plugin without configuring Wallabag, open the queue, tap Sync. | "Wallabag is not configured (missing: server_url)…" message; no crash.                                                                                                          |
| 2   | Configure credentials in the original Wallabag plugin, return to Pilcrow queue.  | First-ever open: cached list (empty) paints, then "Syncing Wallabag…" runs automatically. After it finishes, articles appear. Tapping Sync afterward shows the success summary. |
| 3   | Tap the status chip; pick _Starred_.                                             | Chip updates to "Starred"; only starred articles appear.                                                                                                                        |
| 3b  | Open Tags…, tick two tags, Apply.                                                | Two tag chips appear; only articles having both tags appear; subtitle reads "N results".                                                                                        |
| 3c  | Open Sort…, pick _Oldest first_.                                                 | Sort chip appears; rows are reordered. Tap the sort chip ✕ to reset.                                                                                                            |
| 4   | Type a search term that matches a known article.                                 | Only matching rows appear; "Clear search" in the menu restores the list.                                                                                                        |
| 5   | Tap a row that has not been downloaded.                                          | "Downloading article…" then opens the reader on the article's EPUB.                                                                                                             |
| 6   | Tap the same row again.                                                          | Opens immediately (cached).                                                                                                                                                     |
| 7   | Reach the last page; ConfirmBox appears asking to mark read.                     | Yes → archives on server, removes from unread filter.                                                                                                                           |
| 8   | Long-press a row → Star.                                                         | Star marker appears; row also visible under Starred filter.                                                                                                                     |
| 9   | Long-press → Copy URL.                                                           | "Copied URL: …" message.                                                                                                                                                        |
| 10  | Disconnect Wi-Fi, reopen the queue.                                              | Cached rows render; tapping a non-downloaded row warns about offline state.                                                                                                     |
| 11  | Settings → Open Pilcrow on startup → restart KOReader.                           | Queue view is shown after startup (after the file manager initializes).                                                                                                         |
| 12  | Settings round-trip: change articles per sync to 5, close, reopen settings.      | New value persisted.                                                                                                                                                            |

## Storage

The Readeck backend uses parallel paths so the two backends never share
filenames — flipping `Backend` doesn't trash existing downloads.

| What                               | Wallabag                                                        | Readeck                                                           |
| ---------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------- |
| Article metadata cache             | `<data_dir>/pilcrow/cache.json`                                 | `<data_dir>/pilcrow/readeck-cache.json`                           |
| Downloaded EPUBs                   | `<data_dir>/pilcrow/articles/` (overrideable in Settings)       | `<data_dir>/pilcrow/readeck-articles/` (overrideable in Settings) |
| Preview thumbnails                 | `<data_dir>/pilcrow/images/<id>.jpg`                            | `<data_dir>/pilcrow/readeck-images/<id>.jpg`                      |
| Bundled CSS tweak (auto-installed) | `<data_dir>/styletweaks/wallabag-code.css`                      | same                                                              |
| Plugin settings                    | `<settings_dir>/pilcrow.lua`                                    | same                                                              |
| Credentials                        | `<settings_dir>/wallabag.lua` (shared with the upstream plugin) | `<settings_dir>/readeck.lua` (Pilcrow-only)                       |

## Code-block styling

Many Wallabag articles include code blocks (`<pre>` / `<code>`) which
KOReader renders at body font-size with no frame — long lines overflow
horizontally and Mermaid diagrams fill the whole page.

The plugin ships a CSS tweak (`styles/wallabag-code.css`) that:

- shrinks `pre` / `code` to `0.65em` monospace
- frames `<pre>` blocks in a light-grey box with a thin border
- wraps long lines at the page width (`white-space: pre-wrap`)
- avoids splitting blocks across pages

On startup the plugin copies the file to
`<data_dir>/styletweaks/wallabag-code.css` (idempotent — only writes if
the bytes differ). When you tap an article, the plugin pre-populates
its sidecar with `style_tweaks["wallabag-code.css"] = true` so the
reader picks it up automatically.

Toggle: **Settings → Frame code blocks in opened articles** (default
ON). Disabling it stops new article opens from enabling the tweak;
articles already opened keep their per-document setting.

The tweak is also visible in the regular reader menu under **aA →
Style tweaks → User style tweaks → wallabag-code** — you can edit /
remove it from there too.

## Eink behavior

- No animations, no spinners that redraw rapidly. The only sync indicator is a
  static "Syncing…" `InfoMessage` that closes when sync finishes.
- Lists rerender via `Menu:switchItemTable`, which performs a single partial
  refresh per change.
- Touch targets: `items_per_page = 8`, which on a 1264×1680 Libra 2 display
  yields rows ~210px tall — well above the 88px Kobo minimum.

## Backend differences

A few capabilities are server-specific. Pilcrow hides the rows that don't
apply.

| Feature              | Wallabag | Readeck                                                                                                               |
| -------------------- | -------- | --------------------------------------------------------------------------------------------------------------------- |
| Mark archived / star | ✅       | ✅                                                                                                                    |
| Delete on server     | ✅       | ✅                                                                                                                    |
| Add by URL           | ✅       | ✅                                                                                                                    |
| Refetch (re-extract) | ✅       | ❌ — Readeck's extractor only runs at create-time. The refetch button is hidden when the Readeck backend is selected. |
| OAuth refresh        | ✅       | n/a — Readeck issues long-lived bearer tokens. If the server returns 401, you re-enter the token in Settings.         |

## Not yet

These were scoped out of v1 to keep the patch shippable. PRs welcome.

- **Background auto-sync**: today auto-sync only runs when the queue view
  opens. Continuous background sync hooked into KOReader's network manager
  events (e.g. "WiFi just came up") is not wired yet.
- **Add new article URL** from inside Pilcrow (use the original
  Wallabag plugin's "Add article" action for now).
- **SQLite** cache: JSON is fine for a few hundred articles; switch to
  `lua-ljsqlite3` if profiling shows it.
- **Custom row widget** with separate fonts for title vs metadata. The
  Menu-driven layout uses one font with right-aligned `mandatory` text.
- **Tag editing** per article.
- **Replacing the file manager as the startup screen.** Currently we open the
  queue _after_ the file manager has loaded; KOReader's startup-screen choice
  isn't pluggable without a core change.

## Running the unit tests

A spec file lives at `spec/unit/pilcrow_spec.lua` and exercises
`cache.lua` filter/sort/tag-count logic plus `articlecard.lua`
formatting helpers — no network, no real disk I/O.

KOReader specs depend on KOReader's runtime (`commonrequire` pulls in
C-backed modules like `libs/libkoreader-lfs`). The supported invocation
is via `./kodev`, which provisions a bundled `busted`:

```sh
cd /path/to/koreader
./kodev build                                  # one-time emulator build
./kodev test front pilcrow              # runs only our spec
./kodev test front                             # runs all frontend specs
./kodev run                                    # interactive emulator
```

The first `./kodev build` requires the full prereq list in
[doc/Building.md](../../doc/Building.md) (cmake, ninja, meson, nasm,
autoconf, etc.). On a fresh machine plan ~15 min for prereqs + first
build.

**Quick local syntax check** (no build required):

```sh
cd plugins/pilcrow.koplugin
for f in *.lua; do luac -p "$f" || echo "FAIL $f"; done
```

This catches parse errors and most typos but does not exercise runtime
behaviour.

## Development notes

- Syntax is checked with `luac -p` against Lua 5.5 (matches what KOReader
  bundles closely enough for syntax-only checks).
- The plugin uses standard KOReader `require` paths plus its own siblings
  (`require("cache")`, etc.) — KOReader's plugin loader puts each
  `.koplugin/` directory on `package.path`.
- Cache schema is versioned (`version = 1`); on mismatch, the cache is
  treated as empty rather than migrated.
