# Changelog

All notable changes to this plugin will be documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is
calendar-based (`YYYY.MM.N`) since the plugin tracks KOReader releases more
than its own roadmap.

## [Unreleased]

### Added

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
