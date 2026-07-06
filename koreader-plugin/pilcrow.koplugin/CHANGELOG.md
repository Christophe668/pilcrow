# Changelog

All notable changes to this plugin will be documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is
calendar-based (`YYYY.MM.N`) since the plugin tracks KOReader releases more
than its own roadmap.

## [Unreleased]

## [2026.07.0] - 2026-07-06

### Added

- **Articles download during sync.** A manual sync fetches every missing
  article EPUB (with progress) and a light auto-sync fetches new arrivals
  only, behind a settings toggle — the whole queue is readable fully
  offline, not just articles that were opened once before.

### Fixed

- Highlight bookkeeping now survives sync upserts: pushed/server
  annotation state is preserved (highlights were re-uploaded as
  duplicates on every sync, and the Highlights view emptied on light
  syncs), and the cache is saved right after the push pass.
- Offline "mark as read" flags are pushed at sync start (previously they
  never reached the server), and articles archived or unstarred on other
  clients are reconciled when the fetch window is complete.
- An and/or short-circuit could archive an article after a failed
  unarchive.
- Quiet auto-syncs no longer flash progress popups; the queue reloads
  when shown again.
- Cache flushes are atomic; the download directory is created
  recursively; article ages are timezone-correct.
- Self-update: pre-release-safe version comparison and sanitized release
  asset names; UTF-8-safe filename truncation.

## [2026.05.3] - 2026-05-26

### Changed

- **Auto-sync is now a light pass.** Returning from background only
  refreshes the unread + starred lists and pushes any pending local
  highlights. Preview-image downloads and the per-article annotation
  pull are reserved for an explicit manual sync, so opening Pilcrow
  no longer blocks on the slow tail when the cache is large.
- **Manual sync feels finite.** The highlight-pull progress now shows
  `N / M` instead of a running counter, and cold cache entries
  (articles never downloaded and with no prior server annotations)
  are skipped — the pull only touches articles the user has actually
  read or already has annotations for.

## [2026.05.2] - 2026-05-16

### Changed

- **Reading progress lives on the thumbnail.** The right-column
  percentage + "read" caption is replaced by a slim filled progress bar
  along the bottom of the thumbnail; terminal states ("done" /
  "skipped") append to the meta line. Frees body width for longer
  titles.

### Fixed

- Self-update reported version 0.0.0 and "Install" failed with "Could
  not locate the plugin directory": the plugin directory and version are
  now stashed on SettingsView at init instead of fetched through a
  `require("main")` that silently returned nil.

## [2026.05.1] - 2026-05-16

First packaged release. (`2026.05.0`, published minutes earlier, is an
identical build that exercised the release workflow.)

### Added

- **Highlight sync, both directions, both backends.** KOReader highlights
  are pushed to the configured Wallabag or Readeck server during sync,
  and server-side annotations are pulled back into the cache so they
  show up in a new Highlights list view (accessible from the queue's
  hamburger → Highlights…).
  - **Wallabag** mapping is clean: KOReader `text` → `quote`, KOReader
    `note` → `text`, KOReader `pos0`/`pos1` → `ranges[0]`.
  - **Readeck** mapping is lossy by design: KOReader XPaths don't
    resolve in Readeck's server-HTML tree, so the quoted text + note
    are folded into Readeck's `note` field. Content round-trips; visual
    anchor on the Readeck web UI may not render.
  - Per-article tracking by KOReader's `datetime` field prevents
    re-pushing the same highlight on subsequent syncs.
  - The Highlights view is deliberately a separate list rather than
    overlaid on the article — KOReader's own highlight UI is the
    authoritative experience on-page.
    New modules: `annotationsync.lua`, `highlightsview.lua`.
- **Readeck backend** alongside Wallabag. Pick the backend in
  Settings → Backend; Readeck reads credentials (server URL + bearer
  access token) from `<settings_dir>/readeck.lua` and exposes the same
  filter / sync / archive / star / delete UI as Wallabag. Readeck does
  not support refetch — the row is hidden when that backend is selected.
  Each backend keeps its own cache, downloads, and image directory so
  switching is non-destructive (`readeck-cache.json`,
  `readeck-articles/`, `readeck-images/`).
- `backendclient.lua` factory module and `readeckclient.lua` REST client.
- `_meta.lua`, `main.lua`, `queueview.lua`, `articlerow.lua`,
  `settingsview.lua`, `cache.lua`, `wallabagclient.lua`.
- Fullscreen Wallabag queue with filter (unread / starred / archived / all)
  and substring search over title and domain.
- Per-row long-press actions: archive toggle, star toggle, delete, copy URL.
- On-demand EPUB download on row tap; cached for subsequent opens.
- `EndOfBook` finish prompt with Yes / No / Always / Never (persisted).
- Plugin-local settings: articles per sync, auto-sync on Wi-Fi, open on
  startup, finish-prompt mode, download directory.
- Auto-sync on queue open: cached list paints first, then a background
  sync runs if the _Auto-sync when WiFi is on_ toggle is enabled
  (default ON) and the cache is older than the configurable
  _Auto-sync if cache older than: N min_ threshold (default 10; 0 means
  always sync on open).
- Relative-time subtitle: "synced just now", "synced 5 min ago",
  "synced yesterday" instead of an absolute timestamp.
- **Filtering & sorting**: multi-tag filter (intersection), sort (Newest /
  Oldest / Longest / Shortest / Domain A→Z), and search now compose. State
  for status, tags and sort is persisted across sessions; search is
  session-only.
- **Chip row** widget (`chiprow.lua`) shown between the title bar and the
  article list when any filter is active. Status chip opens a 4-button
  mini-dialog; tag/search/sort chips clear themselves on tap. Wraps to
  multiple lines if there are many active filters.
- Top-bar menu reorganised: separate **Tags…**, **Sort…**, and **Clear
  filters** entries; status moved to its dedicated chip.
- **Card-style rows** (`articlecard.lua`): each article is rendered as a
  thumbnail (preview image) plus two-line title plus a meta line of
  `domain · reading time · age`. Items per page reduced to 5 on a Kobo
  Libra 2. Articles without a preview get a placeholder glyph.
- **Preview-image fetching** during sync (`download_images` setting,
  default ON). Images cached to `<data_dir>/pilcrow/images/`,
  pruned on delete.
- **Interactive status bar** (`statusbar.lua`): the line under the title
  bar now shows counts and last-sync time on the left and a tappable ↻
  square on the right that triggers sync without opening the menu.
- **Bundled code-block styling**: `styles/wallabag-code.css` ships with
  the plugin and is copied to `<data_dir>/styletweaks/` on init.
  When opening an article, the plugin pre-populates its sidecar to
  enable the tweak so KOReader renders `<pre>` / `<code>` blocks
  framed and at 0.65em monospace, with line-wrapping that suits eink.
  Toggle via **Settings → Frame code blocks in opened articles**.
- **Footer interactivity is free**: KOReader's `Menu` already renders
  tappable first/prev/next/last page chevrons and a "jump to page"
  InputDialog when the page indicator is tapped — auto-shown when more
  than one page exists, auto-enabled/disabled based on current page.
  Documented in the mockup; no code change needed.
- Credentials are read from the same `<settings_dir>/wallabag.lua` file as
  the original Wallabag plugin — no duplicate configuration UI.

### Known limitations (see README → "Not yet")

- Continuous background auto-sync (driven by NetworkMgr events) is not
  wired up; auto-sync runs on queue open only.
- No add-article-from-URL inside Pilcrow.
- File manager replacement at startup is not implemented; the queue is shown
  after the file manager loads.
