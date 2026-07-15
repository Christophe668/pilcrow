--[[--
Pilcrow — Wallabag-first reading queue for KOReader.

Replaces (or augments) the file manager with a list of unread Wallabag
articles. All UI logic lives in `queueview.lua`; networking lives in
`wallabagclient.lua`; persistence in `cache.lua`.

@module koplugin.pilcrow
--]]

local ButtonDialog = require("ui/widget/buttondialog")
local ConfirmBox = require("ui/widget/confirmbox")
local DataStorage = require("datastorage")
local Device = require("device")
local Dispatcher = require("dispatcher")
local DocSettings = require("docsettings")
local Event = require("ui/event")
local InfoMessage = require("ui/widget/infomessage")
local NetworkMgr = require("ui/network/manager")
local TextViewer = require("ui/widget/textviewer")
local UIManager = require("ui/uimanager")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local lfs = require("libs/libkoreader-lfs")
local logger = require("logger")
local _ = require("gettext")
local T = require("ffi/util").template

local STYLE_TWEAK_FILE = "wallabag-code.css"

local BackendClient = require("backendclient")
local Cache = require("articlecache")
local QueueView = require("queueview")
local SettingsView = require("settingsview")
local Summarizer = require("summarizer")
local SummaryPage = require("summarypage")

------------------------------------------------------------------------
-- Menu-order injection
--
-- KOReader's menu builder reads a static order array from
-- ui/elements/{reader,filemanager}_menu_order.lua. Plugins that don't
-- appear in that array get appended as orphans at the bottom of the
-- section their `sorting_hint` points to. To put Pilcrow at the *top*
-- of the Tools tab — where the user expects to find it as the primary
-- read-it-later entry — we prepend "pilcrow" to the section the first
-- time this module is loaded. The order table is cached by `require`,
-- so a single mutation is visible to both FileManager and ReaderUI.
------------------------------------------------------------------------

local function prepend_to_order(order_module_name, section)
    local ok, order = pcall(require, order_module_name)
    if not ok or type(order) ~= "table" then return end
    local list = order[section]
    if type(list) ~= "table" then return end
    for _, id in ipairs(list) do
        if id == "pilcrow" then return end  -- idempotent
    end
    table.insert(list, 1, "pilcrow")
end

prepend_to_order("ui/elements/reader_menu_order",      "tools")
prepend_to_order("ui/elements/filemanager_menu_order", "tools")

local PILCROW_VERSION = "0.1.0"

local Pilcrow = WidgetContainer:extend{
    name = "pilcrow",
    is_doc_only = false,
    version = PILCROW_VERSION,
}

------------------------------------------------------------------------
-- Lifecycle
------------------------------------------------------------------------

function Pilcrow:init()
    self.settings = SettingsView.open()
    self.backend_kind = self.settings:get("backend") or "wallabag"
    self.cache    = Cache.open(self.backend_kind)
    self.client   = BackendClient.new(self.settings)
    -- Plugin loader sets `self.path` to the `.koplugin` directory.
    -- Stash it (plus our version) on the SettingsView module so the
    -- self-update menu can read them. We can't rely on `require("main")`
    -- from the settings panel: main.lua is loaded via `dofile` and the
    -- plugin root is dropped from package.path right after, so the
    -- require would silently return nil. SettingsView, by contrast, was
    -- loaded with `require` and is in package.loaded, so its module-
    -- level fields survive across event handlers.
    if self.path and self.path ~= "" then
        SettingsView.setPluginInfo(self.path, PILCROW_VERSION)
    end

    self:_ensureDownloadDir()
    self:_ensureStyleTweakInstalled()
    self:onDispatcherRegisterActions()
    if self.ui and self.ui.menu then
        self.ui.menu:registerToMainMenu(self)
    end

    -- When the reader is opening a Pilcrow-fetched article, hijack the
    -- top-of-screen tap so the user lands on a focused Pilcrow action
    -- sheet (mark read, star, refetch, back to queue, …) instead of
    -- KOReader's generic reader menu. The original menu remains one
    -- tap away from the sheet.
    self:_maybeInstallTopTapOverride()

    local ctx = (self.ui and self.ui.document) and "ReaderUI" or "FileManager"
    logger.dbg("pilcrow: init in", ctx,
        "open_on_startup=", self.settings:get("open_on_startup"),
        "launched_once=", Pilcrow._launched_once and true or false,
        "return_flag=", Pilcrow._show_queue_after_close and true or false)

    -- Returning from the reader after an article ended? Reopen the queue.
    -- This flag is set by `_returnToQueueAfterClose` before the reader is
    -- closed; the file-manager-side plugin instance picks it up here.
    if Pilcrow._show_queue_after_close then
        Pilcrow._show_queue_after_close = false
        UIManager:nextTick(function() self:openQueue() end)
    -- Open on startup if configured. Fire from whichever init runs
    -- first this session (FileManager or ReaderUI): when KOReader
    -- resumes the last-read book it skips the FileManager pass
    -- entirely, so a FileManager-only guard would silently ignore the
    -- toggle for anyone with a book in progress. The class-level
    -- `_launched_once` flag still keeps the second init from
    -- double-firing within the same process.
    elseif self.settings:get("open_on_startup")
       and not Pilcrow._launched_once then
        Pilcrow._launched_once = true
        logger.dbg("pilcrow: open-on-startup firing in", ctx)
        UIManager:nextTick(function() self:openQueue() end)
    end
end

function Pilcrow:onDispatcherRegisterActions()
    Dispatcher:registerAction("pilcrow_open", {
        category = "none",
        event    = "PilcrowOpen",
        title    = _("Open Pilcrow queue"),
        general  = true,
    })
    Dispatcher:registerAction("pilcrow_sync", {
        category = "none",
        event    = "PilcrowSync",
        title    = _("Sync Pilcrow queue"),
        general  = true,
    })
end

function Pilcrow:addToMainMenu(menu_items)
    -- `sorting_hint` is consulted by MenuSorter when the entry's id
    -- isn't listed in the menu order file. We hint "tools" so it
    -- lands next to Wallabag and news_downloader in the reader's
    -- Tools tab; in the FileManager menu, "tools" exists too and
    -- works the same way. Without a hint, the entry shows up with
    -- a "NEW:" prefix in an unpredictable tab.
    menu_items.pilcrow = {
        text = _("Pilcrow"),
        sorting_hint = "tools",
        callback = function()
            if self.ui and self.ui.document then
                -- Called from inside the reader: close the article
                -- first so the queue paints over a clean state and
                -- the next "Back" sends the user home, not back
                -- into the same article.
                self:_returnToQueue()
            else
                self:openQueue()
            end
        end,
    }
end

function Pilcrow:_ensureDir(dir)
    if not dir or dir == "" then return end
    if lfs.attributes(dir, "mode") == "directory" then return end
    -- Create every missing level, not just the immediate parent — a
    -- user-configured download dir can be arbitrarily deep.
    local prefix = dir:sub(1, 1) == "/" and "/" or ""
    local acc = prefix
    for part in dir:gmatch("[^/]+") do
        acc = acc == prefix and (prefix .. part) or (acc .. "/" .. part)
        if lfs.attributes(acc, "mode") ~= "directory" then
            lfs.mkdir(acc)
        end
    end
end

function Pilcrow:_ensureDownloadDir()
    self:_ensureDir(self.settings:downloadDir())
end

function Pilcrow:_ensureImageDir()
    self:_ensureDir(self.settings:imageDir())
end

local IMAGE_EXTENSIONS = { "jpg", "jpeg", "png", "gif", "bmp", "img" }

local function sanitize_id(id)
    -- Image / EPUB file names embed the article id. Wallabag uses
    -- integers; Readeck uses ~10-char base62 strings. Strip anything
    -- that wouldn't be safe in a filename so an exotic backend id
    -- can't break path joins.
    local s = tostring(id or "")
    return (s:gsub("[^%w%-_]", "_"))
end

local function image_filename_for(id)
    -- KOReader's ImageWidget refuses paths whose extension isn't a known
    -- image format. .jpg is the safe default — most preview_picture
    -- responses are JPEG. If the body turns out to be WebP/AVIF, MµPDF
    -- returns nil from renderImageFile and falls back to a checkerboard
    -- (no crash).
    return sanitize_id(id) .. ".jpg"
end

function Pilcrow:_imagePathFor(id)
    return self.settings:imageDir() .. "/" .. image_filename_for(id)
end

local function safe_filename(id, title)
    local cleaned = (title or "untitled"):gsub("[%c/\\:%*%?\"<>|]", " ")
    cleaned = cleaned:gsub("%s+", " ")
    if #cleaned > 100 then
        cleaned = cleaned:sub(1, 100)
        -- Byte-level cut can split a UTF-8 sequence; drop the partial
        -- (or final complete) multi-byte char rather than keep junk bytes.
        cleaned = cleaned:gsub("[\194-\244][\128-\191]*$", "")
    end
    -- Historical marker "[wr-id_<id>]" works for both Wallabag (numeric
    -- id) and Readeck (alphanumeric id). `parse_id_from_path` matches
    -- the same shape.
    return string.format("[wr-id_%s] %s.epub", sanitize_id(id), cleaned)
end

--- True when the article's epub isn't on disk (never downloaded, or the
--- file was removed behind our back).
local function needs_download(article)
    local path = article.local_path
    return not (path and path ~= "" and lfs.attributes(path, "mode") == "file")
end

function Pilcrow:_downloadArticleTo(article)
    local dir = self.settings:downloadDir()
    self:_ensureDownloadDir()
    local fpath = dir .. "/" .. safe_filename(article.id, article.title)
    local ok, err_or_path, http_code = self.client:downloadEntry(article.id, fpath, "epub")
    if not ok then return false, err_or_path, http_code end
    self.cache:setLocalPath(article.id, fpath)
    -- A summary generated before this (re)download — refetch, manual
    -- generation while offline, pre-existing cache — goes straight
    -- into the fresh file while it's guaranteed sidecar-free.
    local cached = self.cache:get(article.id)
    if cached and cached.summary and cached.summary ~= "" then
        self:_maybeEmbedSummary(cached)
    end
    return true, fpath
end

function Pilcrow:_pruneImageFor(id)
    -- Remove any cached preview, regardless of historical extension.
    local dir = self.settings:imageDir()
    local sid = sanitize_id(id)
    for _, ext in ipairs(IMAGE_EXTENSIONS) do
        local p = string.format("%s/%s.%s", dir, sid, ext)
        if lfs.attributes(p, "mode") == "file" then
            os.remove(p)
        end
    end
end

------------------------------------------------------------------------
-- Code-block style tweak
--
-- KOReader auto-discovers `.css` files dropped under
-- `<DataDir>/styletweaks/` and exposes them in its Style-tweaks menu.
-- We bundle ours with the plugin (under `styles/`) and copy it on init
-- (idempotent — overwrites only when content differs). When opening an
-- article, we then write the per-document setting that tells
-- ReaderStyleTweak to enable it.
------------------------------------------------------------------------

local function read_file(path)
    local fh = io.open(path, "rb")
    if not fh then return nil end
    local content = fh:read("*a")
    fh:close()
    return content
end

local function write_file(path, content)
    local fh = io.open(path, "wb")
    if not fh then return false end
    fh:write(content)
    fh:close()
    return true
end

function Pilcrow:_styleTweakDestPath()
    return DataStorage:getDataDir() .. "/styletweaks/" .. STYLE_TWEAK_FILE
end

function Pilcrow:_styleTweakSourcePath()
    -- self.path is set by the plugin loader to the .koplugin directory.
    return (self.path or ".") .. "/styles/" .. STYLE_TWEAK_FILE
end

--- Copy our bundled CSS into KOReader's user styletweaks directory.
-- Idempotent: skips the write if the destination already has the same
-- bytes. Logs and continues on failure (the article still opens; the
-- tweak just isn't applied).
function Pilcrow:_ensureStyleTweakInstalled()
    local source = self:_styleTweakSourcePath()
    local dest_dir = DataStorage:getDataDir() .. "/styletweaks"
    local dest = self:_styleTweakDestPath()

    local source_content = read_file(source)
    if not source_content then
        logger.warn("pilcrow: bundled CSS missing at", source)
        return
    end

    if lfs.attributes(dest_dir, "mode") ~= "directory" then
        lfs.mkdir(dest_dir)
    end

    if read_file(dest) == source_content then return end
    if not write_file(dest, source_content) then
        logger.warn("pilcrow: failed to install CSS to", dest)
    end
end

--- Enable our style tweak for `filepath` by writing to its sidecar.
-- Safe to call before the reader opens the document; ReaderStyleTweak
-- reads `style_tweaks` + `style_tweaks_enabled` from doc settings on
-- load.
function Pilcrow:_enableStyleTweakFor(filepath)
    if not self.settings:get("apply_code_style") then return end
    if not filepath or filepath == "" then return end

    local doc_settings = DocSettings:open(filepath)
    if not doc_settings then return end

    local tweaks = doc_settings:readSetting("style_tweaks") or {}
    if not tweaks[STYLE_TWEAK_FILE] then
        tweaks[STYLE_TWEAK_FILE] = true
        doc_settings:saveSetting("style_tweaks", tweaks)
    end
    -- nilOrTrue at read time means missing == enabled, but be explicit.
    doc_settings:saveSetting("style_tweaks_enabled", true)
    doc_settings:flush()
end

------------------------------------------------------------------------
-- Queue view
------------------------------------------------------------------------

--- Rebuild cache + client if the user flipped the backend in
--- settings since the last open. Triggered on each `openQueue` so the
--- switch doesn't require a KOReader restart.
function Pilcrow:_reloadBackendIfChanged()
    local kind = self.settings:get("backend") or "wallabag"
    if kind == self.backend_kind then return end
    self.backend_kind = kind
    self.cache  = Cache.open(kind)
    self.client = BackendClient.new(self.settings)
    self:_ensureDownloadDir()
    -- Tear down the existing queue widget — both the cached instance
    -- and any on-screen copy — so the next openQueue() builds a fresh
    -- one bound to the new cache.
    if self._queue and self._queue.show_parent then
        UIManager:close(self._queue)
    end
    self._queue = nil
end

function Pilcrow:openQueue()
    self:_reloadBackendIfChanged()
    -- The "in progress" status is computed from sidecar progress, which
    -- almost certainly changed while the user was reading. Bust the
    -- per-article memo so the next list / count call re-reads sidecars.
    if self.cache.invalidateProgress then self.cache:invalidateProgress() end
    if self._queue and self._queue.show_parent then
        -- Recompute the list before painting: progress states, sync
        -- results, and row actions may all have changed since the
        -- widget was last on screen — without this, the invalidation
        -- above never takes effect on re-show.
        if self._queue.reload then self._queue:reload() end
        UIManager:show(self._queue)
        self:_maybeAutoSync()
        return
    end
    self._queue = QueueView:new{
        cache              = self.cache,
        settings           = self.settings,
        backend_kind       = self.backend_kind,
        supports_reload    = self.client.supports_reload and true or false,
        has_progress_fn    = function(article) return self:_articleHasProgress(article) end,
        on_open_article    = function(article) self:openArticle(article) end,
        on_action          = function(action, article, refresh_cb)
            self:handleRowAction(action, article, refresh_cb)
        end,
        on_sync            = function(refresh_cb) self:syncNow(refresh_cb) end,
        on_open_settings   = function() self.settings:show() end,
        on_open_koreader_menu = function() self:_openKoreaderMenu() end,
        on_open_highlights = function() self:_openHighlights() end,
    }
    UIManager:show(self._queue)
    self:_maybeAutoSync()
end

--- Open the cross-article Highlights list. Reads from
--  `article.server_annotations` populated by the last sync's pull;
--  if you've never synced with a backend that supports annotations
--  the list will be empty.
function Pilcrow:_openHighlights()
    local HighlightsView = require("highlightsview")
    HighlightsView.open{ cache = self.cache }
end

function Pilcrow:_maybeAutoSync()
    if not self.settings:get("auto_sync_on_wifi") then return end
    if not self.client:isConfigured() then return end
    if not NetworkMgr:isOnline() then return end

    -- Threshold of 0 means "always sync on open"; positive values gate it.
    local minutes = tonumber(self.settings:get("auto_sync_stale_minutes")) or 10
    local last    = self.cache:lastSynced() or 0
    if minutes > 0 and (os.time() - last) < (minutes * 60) then return end

    -- Defer one tick so the cached queue paints before we block on HTTP.
    -- Auto-sync is a light pass: refresh the unread / starred lists and
    -- push any pending highlights. Image previews and per-article
    -- annotation pulls are deferred to an explicit manual sync, which
    -- can do the full sweep without delaying the user's reading.
    UIManager:nextTick(function()
        self:syncNow(function()
            if self._queue then self._queue:reload() end
        end, { quiet = true, full = false })
    end)
end

--- Open the host's main menu (FileManager's or ReaderUI's hamburger).
-- The queue widget sits on top of whichever shell launched it; calling
-- this surfaces a modal menu so the user can reach core KOReader
-- features (Tools, Plugin management, Exit, …) without leaving Pilcrow.
function Pilcrow:_openKoreaderMenu()
    if self.ui and self.ui.menu and self.ui.menu.onShowMenu then
        self.ui.menu:onShowMenu()
    else
        UIManager:show(InfoMessage:new{
            text = _("KOReader menu is not available from this context."),
            timeout = 2,
        })
    end
end

function Pilcrow:onPilcrowOpen()
    self:openQueue()
    return true
end

function Pilcrow:onPilcrowSync()
    self:syncNow()
    return true
end

--- Intercept the reader's Back action when reading a Pilcrow article
-- and send the user to the queue instead of triggering KOReader's
-- generic "back to file browser / exit" flow. Returning `true` short-
-- circuits `ReaderBack:onBack` and the back-to-exit prompt.
-- For non-Pilcrow documents we return nothing, so the user's normal
-- back behaviour (location stack, back-to-exit prompt, …) is intact.
function Pilcrow:onBack()
    if not self:_currentArticleId() then return end
    self:_returnToQueue()
    return true
end

--- Fired by SettingsView when the user picks a different backend.
--- We rebuild cache+client and, if the queue is currently visible,
--- close it and immediately reopen against the new backend so the
--- swap is visible without the user re-navigating from the main menu.
function Pilcrow:onPilcrowBackendChanged()
    local was_visible = self._queue and self._queue.show_parent
    self:_reloadBackendIfChanged()  -- nils out self._queue
    if was_visible then
        UIManager:nextTick(function() self:openQueue() end)
    end
    return true
end

------------------------------------------------------------------------
-- Sync
------------------------------------------------------------------------

local BACKEND_TITLES = {
    wallabag = _("Wallabag"),
    readeck  = _("Readeck"),
}

function Pilcrow:_backendTitle()
    return BACKEND_TITLES[self.backend_kind] or _("Wallabag")
end

function Pilcrow:syncNow(refresh_cb, opts)
    opts = opts or {}
    local title = self:_backendTitle()
    -- Pick up any credentials the user just edited in Settings without
    -- needing a plugin reload. Cheap — re-reads a small .lua file.
    if self.client.reload then self.client:reload() end
    local ok, missing = self.client:isConfigured()
    if not ok then
        if not opts.quiet then
            local hint
            if self.backend_kind == "readeck" then
                hint = _("Open Pilcrow settings and tap \"Readeck server & token\".")
            else
                hint = _("Open the original Wallabag plugin's settings first.")
            end
            UIManager:show(InfoMessage:new{
                text = T(_("%1 is not configured (missing: %2).\n%3"),
                         title, missing, hint),
            })
        end
        return
    end

    local kickoff = function()
        -- Closure that owns the visible progress widget. Each call
        -- replaces the prior message in-place so the user sees coarse
        -- phase changes without rapid eink redraws. Quiet (auto) syncs
        -- stay genuinely silent — no progress popups at all.
        local info
        local function set_progress(text)
            if opts.quiet then return end
            if info then UIManager:close(info) end
            info = InfoMessage:new{ text = text }
            UIManager:show(info)
            UIManager:forceRePaint()
        end
        local function close_progress()
            if info then UIManager:close(info) end
            info = nil
        end

        set_progress(T(_("Syncing %1…"), title))
        self:_doSync(function(summary)
            close_progress()
            if not opts.quiet then
                UIManager:show(InfoMessage:new{ text = summary, timeout = 3 })
            end
            if refresh_cb then refresh_cb() end
        end, {
            set_progress = set_progress,
            title        = title,
            -- Default to a full sweep so explicit user-triggered syncs
            -- (Dispatcher action, "Sync" button) always do the heavy work.
            full         = (opts.full ~= false),
        })
    end

    -- For an explicit sync we want to wait for connectivity; for an auto
    -- sync we silently skip if offline rather than nag the user.
    if opts.quiet and not NetworkMgr:isOnline() then return end
    if NetworkMgr:willRerunWhenOnline(kickoff) then return end
    kickoff()
end

function Pilcrow:_doSync(done_cb, ctx)
    ctx = ctx or {}
    local set_progress = ctx.set_progress or function() end
    local title = ctx.title or self:_backendTitle()
    local full = (ctx.full ~= false)
    local per_page = self.settings:get("articles_per_sync") or 30

    -- Push offline "mark as read" flags first: `_markFinished` records
    -- `finished` locally when the device is offline (or the archive call
    -- failed) and promises the user it syncs later — this is that later.
    -- Doing it before the fetches also means the reconcile pass below
    -- sees the server's post-archive state.
    local pending_archive = {}
    for _, key in ipairs(self.cache:listIds()) do
        local a = self.cache:get(key)
        if a and a.finished and not a.is_archived then
            pending_archive[#pending_archive + 1] = a
        end
    end
    if #pending_archive > 0 then
        set_progress(T(_("%1: pushing read status… 0 / %2"), title, #pending_archive))
        for i, a in ipairs(pending_archive) do
            if self.client:archiveEntry(a.id) then
                self.cache:setFlag(a.id, "is_archived", true)
            end
            if i == #pending_archive or i % 5 == 0 then
                set_progress(T(_("%1: pushing read status… %2 / %3"),
                               title, i, #pending_archive))
            end
        end
        self.cache:save()
    end

    set_progress(T(_("%1: fetching unread articles…"), title))
    local ok, items_or_err = self.client:listEntries({
        archive  = 0,
        perPage  = per_page,
        maxItems = per_page,
        on_progress = function(page, count)
            set_progress(T(_("%1: fetching unread… page %2 (%3 articles)"),
                           title, page, count))
        end,
    })
    if not ok then
        done_cb(T(_("Sync failed: %1"), tostring(items_or_err)))
        return
    end

    -- `seen` keys are tostring(id) — the same keying the cache uses —
    -- so the reconcile pass below can compare against `listIds`.
    -- `new_articles` collects entries this device had never cached;
    -- light syncs restrict the epub download phase to just those.
    local seen = {}
    local unread_seen = {}
    local new_articles = {}
    -- Wallabag entries arrive with their annotations embedded; the
    -- cache upsert drops them, so stash them aside for the annotation
    -- pull below — every entry covered here is one round-trip saved.
    local embedded_annotations = {}
    local function ingest(api_article, seen_map)
        local key = tostring(api_article.id)
        if not self.cache:get(key) then
            new_articles[#new_articles + 1] = key
        end
        self.cache:upsertFromApi(api_article)
        if type(api_article.annotations) == "table" then
            embedded_annotations[key] = api_article.annotations
        end
        seen[key] = true
        seen_map[key] = true
    end
    for _, api_article in ipairs(items_or_err) do
        ingest(api_article, unread_seen)
    end
    -- Fewer items than the cap means the fetch covered the complete
    -- server-side unread list, so absences are meaningful.
    local unread_complete = #items_or_err < per_page

    -- Also pull a page of starred articles so they appear in the Starred filter.
    set_progress(T(_("%1: fetching starred articles…"), title))
    local starred_seen = {}
    local starred_complete = false
    local s_ok, starred = self.client:listEntries({
        archive = 0, starred = 1, perPage = per_page, maxItems = per_page,
        on_progress = function(page, count)
            set_progress(T(_("%1: fetching starred… page %2 (%3 articles)"),
                           title, page, count))
        end,
    })
    if s_ok then
        for _, api_article in ipairs(starred) do
            ingest(api_article, starred_seen)
        end
        starred_complete = #starred < per_page
    end

    -- Reconcile state changed on other clients: when a fetch window was
    -- complete, a cached article missing from it is no longer in that
    -- state on the server (archived / deleted / unstarred elsewhere).
    -- Without this, ghost rows sit in the Unread queue forever.
    if unread_complete then
        for _, key in ipairs(self.cache:listIds()) do
            local a = self.cache:get(key)
            if a and not a.is_archived and not unread_seen[key] then
                self.cache:setFlag(a.id, "is_archived", true)
            end
        end
    end
    if starred_complete then
        for _, key in ipairs(self.cache:listIds()) do
            local a = self.cache:get(key)
            -- The starred fetch only covers unarchived entries, so an
            -- archived favourite's absence proves nothing — skip those.
            if a and a.is_starred and not a.is_archived and not starred_seen[key] then
                self.cache:setFlag(a.id, "is_starred", false)
            end
        end
    end

    -- Optionally fetch preview images. Best-effort: any failure is logged
    -- and we continue. This serializes downloads (Lua's HTTP client is
    -- blocking) but at most touches `articles_per_sync` images.
    -- Skipped on light (auto) syncs so returning from background stays snappy.
    local images_dl, images_skipped = 0, 0
    if full and self.settings:get("download_images") then
        self:_ensureImageDir()

        -- Count first so we can show "N of M" instead of just a running tally.
        local to_download = {}
        for id in pairs(seen) do
            local article = self.cache:get(id)
            if article and article.preview_picture and article.preview_picture ~= "" then
                local path = self:_imagePathFor(id)
                if lfs.attributes(path, "mode") ~= "file" then
                    to_download[#to_download + 1] = { id = id, path = path, article = article }
                else
                    if article.image_path ~= path then
                        self.cache:setFlag(id, "image_path", path)
                    end
                end
            end
        end

        local total_to_dl = #to_download
        if total_to_dl > 0 then
            set_progress(T(_("%1: downloading previews… 0 / %2"),
                           title, total_to_dl))
        end

        local done = 0
        for _i, item in ipairs(to_download) do
            local id, path, article = item.id, item.path, item.article
            -- Sweep any legacy paths (e.g. old `.img` files) before
            -- downloading the fresh canonical copy.
            self:_pruneImageFor(id)
            local dl_ok = self.client:downloadUrl(article.preview_picture, path)
            if dl_ok then
                self.cache:setFlag(id, "image_path", path)
                images_dl = images_dl + 1
            else
                self.cache:setFlag(id, "image_path", nil)
                images_skipped = images_skipped + 1
            end
            done = done + 1
            -- Refresh the progress line every few items rather than
            -- every one — keeps eink redraws coarse without leaving
            -- the user staring at a stale number for too long.
            if done == total_to_dl or done % 5 == 0 then
                set_progress(T(_("%1: downloading previews… %2 / %3"),
                               title, done, total_to_dl))
            end
        end
    end

    -- Download article epubs so everything in the queue is readable
    -- offline — the whole point of syncing on an eink device. Full syncs
    -- sweep every fetched article that's missing its file; light (auto)
    -- syncs only fetch the articles that are new since the last sync, so
    -- returning from background stays quick while new arrivals are still
    -- made available offline. Best-effort: failures are counted and the
    -- tap-to-open path remains as the fallback downloader.
    local epubs_dl, epubs_failed = 0, 0
    if self.settings:get("download_articles") then
        local targets = {}
        local candidates = full and seen or nil
        if candidates then
            for key in pairs(candidates) do
                local article = self.cache:get(key)
                if article and not article.is_archived and needs_download(article) then
                    targets[#targets + 1] = article
                end
            end
        else
            for _, key in ipairs(new_articles) do
                local article = self.cache:get(key)
                if article and not article.is_archived and needs_download(article) then
                    targets[#targets + 1] = article
                end
            end
        end

        local total_epubs = #targets
        if total_epubs > 0 then
            set_progress(T(_("%1: downloading articles… 0 / %2"), title, total_epubs))
        end
        for i, article in ipairs(targets) do
            local dl_ok = self:_downloadArticleTo(article)
            if dl_ok then
                epubs_dl = epubs_dl + 1
            else
                epubs_failed = epubs_failed + 1
            end
            if i == total_epubs or i % 3 == 0 then
                set_progress(T(_("%1: downloading articles… %2 / %3"),
                               title, i, total_epubs))
            end
        end
        if epubs_dl > 0 then self.cache:save() end
    end

    -- Two-way annotation sync. Push first so any new local highlights
    -- exist on the server before we pull, then pull so the Highlights
    -- view reflects the freshest set including the ones we just sent.
    -- Best-effort throughout: per-article failures are logged inside
    -- the module, never abort the sweep.
    --
    -- Light syncs push (cheap — usually nothing to send) but skip the
    -- per-article pull, which is the slow tail of a full sync.
    local push_counters = { pushed = 0, skipped = 0, failed = 0 }
    local pull_counters = { fetched = 0, articles = 0, failed = 0 }
    if self.client.createAnnotation or (full and self.client.listAnnotations) then
        local AnnotationSync = require("annotationsync")
        if self.client.createAnnotation then
            set_progress(T(_("%1: pushing highlights…"), title))
            push_counters = AnnotationSync.pushAll(self.cache, self.client, function(pushed)
                set_progress(T(_("%1: pushing highlights… %2 pushed"), title, pushed))
            end)
            -- Persist the pushed-markers immediately: if the pull tail
            -- below is interrupted (crash, battery), losing them would
            -- re-upload every highlight next sync.
            self.cache:save()
        end
        if full and self.client.listAnnotations then
            set_progress(T(_("%1: pulling highlights…"), title))
            pull_counters = AnnotationSync.pullAll(self.cache, self.client, function(done, total, _fetched)
                set_progress(T(_("%1: pulling highlights… %2 / %3"),
                               title, done, total))
            end, { embedded = embedded_annotations })
        end
    end

    self.cache:markSynced()
    self.cache:save()

    local count = 0
    for _ in pairs(seen) do count = count + 1 end
    local msg = T(_("Sync complete: %1 articles refreshed."), count)
    if epubs_dl + epubs_failed > 0 then
        msg = msg .. " " .. T(_("(%1 articles downloaded, %2 failed)"), epubs_dl, epubs_failed)
    end
    if images_dl + images_skipped > 0 then
        msg = msg .. " " .. T(_("(%1 images, %2 skipped)"), images_dl, images_skipped)
    end
    if push_counters.pushed > 0 or push_counters.failed > 0 then
        msg = msg .. " " .. T(_("(%1 highlights pushed, %2 failed)"),
                              push_counters.pushed, push_counters.failed)
    end
    if pull_counters.fetched > 0 then
        msg = msg .. " " .. T(_("(%1 highlights on server)"), pull_counters.fetched)
    end
    done_cb(msg)
end

------------------------------------------------------------------------
-- Per-row actions (called by QueueView)
------------------------------------------------------------------------

function Pilcrow:handleRowAction(action, article, refresh_cb)
    if action == "copy_url" then
        if article.url and article.url ~= "" and Device.input
                and Device.input.setClipboardText then
            Device.input.setClipboardText(article.url)
            UIManager:show(InfoMessage:new{
                text = T(_("Copied URL: %1"), article.url), timeout = 2,
            })
        end
        return
    end

    if action == "clear_progress" then
        self:_clearArticleProgress(article)
        if refresh_cb then refresh_cb() end
        return
    end

    if action == "summary" then
        self:showSummary(article)
        return
    end

    if not NetworkMgr:isOnline() then
        UIManager:show(InfoMessage:new{
            text = _("This action needs network connectivity."), timeout = 2,
        })
        return
    end

    local id = article.id
    if action == "toggle_archive" then
        -- Explicit if/else: an `a and f() or g()` chain would fall through
        -- to archiveEntry when unarchiveEntry fails, silently re-archiving
        -- on the server while the cache flips to unread.
        local ok
        if article.is_archived then
            ok = self.client:unarchiveEntry(id)
        else
            ok = self.client:archiveEntry(id)
        end
        if ok then
            self.cache:setFlag(id, "is_archived", not article.is_archived)
            self.cache:save()
            if refresh_cb then refresh_cb() end
        else
            UIManager:show(InfoMessage:new{ text = _("Action failed."), timeout = 2 })
        end
    elseif action == "toggle_star" then
        local ok = self.client:starEntry(id, not article.is_starred)
        if ok then
            self.cache:setFlag(id, "is_starred", not article.is_starred)
            self.cache:save()
            if refresh_cb then refresh_cb() end
        else
            UIManager:show(InfoMessage:new{ text = _("Action failed."), timeout = 2 })
        end
    elseif action == "delete" then
        local ok = self.client:deleteEntry(id)
        if ok then
            if article.local_path and lfs.attributes(article.local_path, "mode") == "file" then
                os.remove(article.local_path)
            end
            self:_pruneImageFor(id)
            self.cache:remove(id)
            self.cache:save()
            if refresh_cb then refresh_cb() end
        else
            UIManager:show(InfoMessage:new{ text = _("Delete failed."), timeout = 2 })
        end
    elseif action == "refetch" then
        if not self.client.supports_reload then
            UIManager:show(InfoMessage:new{
                text = _("Refetch is not supported by this backend."), timeout = 2,
            })
            return
        end
        local info = InfoMessage:new{ text = _("Asking the server to re-fetch…") }
        UIManager:show(info)
        UIManager:forceRePaint()
        local ok, refreshed, http_code = self.client:reloadEntry(id)
        UIManager:close(info)
        if not ok then
            local detail = refreshed == "http_error" and http_code
                and T(_("HTTP %1"), http_code)
                or tostring(refreshed)
            UIManager:show(InfoMessage:new{
                text = T(_("Refetch failed: %1"), detail),
            })
            return
        end
        if type(refreshed) == "table" and refreshed.id then
            self.cache:upsertFromApi(refreshed)
        end
        if article.local_path and lfs.attributes(article.local_path, "mode") == "file" then
            os.remove(article.local_path)
        end
        self.cache:setFlag(id, "local_path", nil)
        self.cache:setFlag(id, "summary_in_epub", nil)
        self:_pruneImageFor(id)
        self.cache:setFlag(id, "image_path", nil)
        self.cache:save()
        UIManager:show(InfoMessage:new{
            text = _("Article refreshed."), timeout = 2,
        })
        if refresh_cb then refresh_cb() end
    end
end

------------------------------------------------------------------------
-- Article summaries (LLM-generated, cached on the article entry)
------------------------------------------------------------------------

--- Rewrite the article's EPUB so the cached summary is its first page.
-- Hard requirement: never touch a document the user has opened —
-- crengine addresses highlights and reading positions by DocFragment
-- index (`/body/DocFragment[N]/…`), so inserting a page would shift
-- every existing anchor. Such articles keep the popup summary only.
-- Returns true when the page was (re)written into the EPUB.
function Pilcrow:_maybeEmbedSummary(article)
    if not self.settings:get("summary_embed_in_epub") then return false end
    if not article or not article.summary or article.summary == "" then
        return false
    end
    local path = article.local_path
    if not path or path == "" or lfs.attributes(path, "mode") ~= "file" then
        return false
    end
    if DocSettings:hasSidecarFile(path) then return false end
    -- ffi/archiver ships with current KOReader; degrade to popup-only
    -- summaries on builds that predate it.
    local ok_arch, archiver = pcall(require, "ffi/archiver")
    if not ok_arch then
        logger.warn("pilcrow/summary: ffi/archiver unavailable; summary page skipped")
        return false
    end
    local xhtml = SummaryPage.build_xhtml(article, article.summary, article.summary_model)
    local ok, err = SummaryPage.inject(path, xhtml, { archiver = archiver })
    if not ok then
        logger.warn("pilcrow/summary: embed failed for", article.id, err)
        return false
    end
    self.cache:setFlag(article.id, "summary_in_epub", true)
    self.cache:save()
    return true
end

function Pilcrow:showSummary(article)
    if article.summary and article.summary ~= "" then
        self:_showSummaryDialog(article)
        return
    end
    self:_generateSummary(article)
end

function Pilcrow:_generateSummary(article)
    local cfg = self.settings:summaryConfig()
    if not cfg.api_key or cfg.api_key == "" then
        UIManager:show(InfoMessage:new{
            text = _("Set an API key first (Settings → Summaries)."),
            timeout = 3,
        })
        return
    end
    -- Same flow the sync path uses (main.lua ~line 555): if wifi is off,
    -- KOReader prompts to enable it and re-runs this function once online.
    if NetworkMgr:willRerunWhenOnline(function() self:_generateSummary(article) end) then
        return
    end

    local info = InfoMessage:new{ text = _("Summarizing…") }
    UIManager:show(info)
    UIManager:forceRePaint()
    local ok, result = Summarizer.summarize(article, self.client, cfg, {
        lfs = lfs,
        execute = os.execute,
        tmp_dir = DataStorage:getDataDir() .. "/pilcrow/summary-tmp",
    })
    UIManager:close(info)

    if not ok then
        UIManager:show(InfoMessage:new{
            text = T(_("Summary failed: %1"), tostring(result)),
        })
        return
    end

    self.cache:setFlag(article.id, "summary", result)
    self.cache:setFlag(article.id, "summary_model", cfg.model)
    self.cache:save()
    self:_maybeEmbedSummary(self.cache:get(article.id))
    self:_showSummaryDialog(self.cache:get(article.id) or article)
end

function Pilcrow:_showSummaryDialog(article)
    local viewer
    local footer = (article.summary_model and article.summary_model ~= "")
        and ("\n\n— " .. article.summary_model) or ""
    viewer = TextViewer:new{
        title = article.title or _("Summary"),
        text = (article.summary or "") .. footer,
        buttons_table = {{
            { text = _("Close"),
              callback = function() UIManager:close(viewer) end },
            { text = _("Regenerate"),
              callback = function()
                  UIManager:close(viewer)
                  self:_generateSummary(article)
              end },
        }},
    }
    UIManager:show(viewer)
end

------------------------------------------------------------------------
-- Opening articles
------------------------------------------------------------------------

function Pilcrow:openArticle(article)
    local path = article.local_path
    local exists = path and lfs.attributes(path, "mode") == "file"

    local function launch(local_path)
        self:_enableStyleTweakFor(local_path)
        local ReaderUI = require("apps/reader/readerui")
        UIManager:close(self._queue)
        ReaderUI:showReader(local_path)
    end

    if exists then
        launch(path)
        return
    end

    if not NetworkMgr:isOnline() then
        UIManager:show(InfoMessage:new{
            text = _("This article hasn't been downloaded yet. Connect to the network and try again."),
            timeout = 3,
        })
        return
    end

    local info = InfoMessage:new{ text = _("Downloading article…") }
    UIManager:show(info)
    UIManager:forceRePaint()

    local ok, err_or_path, http_code = self:_downloadArticleTo(article)
    UIManager:close(info)
    if not ok then
        UIManager:show(InfoMessage:new{
            text = T(_("Download failed: %1 (HTTP %2)"),
                tostring(err_or_path), tostring(http_code or "?")),
        })
        return
    end

    self.cache:save()
    launch(err_or_path)
end

------------------------------------------------------------------------
-- Mark-on-finish prompt
------------------------------------------------------------------------

local function parse_id_from_path(path)
    if not path then return nil end
    -- Accept any id token that survives `sanitize_id` (alphanumeric +
    -- `-` / `_`). Returns the id as a string so callers can hand it
    -- straight to the cache, which keys by `tostring(id)` regardless
    -- of backend.
    local id = path:match("%[wr%-id_([%w_%-]+)%]")
    return id
end

------------------------------------------------------------------------
-- Top-tap override
--
-- KOReader wires the top-of-screen tap directly to `ReaderMenu:onTapShowMenu`
-- via gesture handlers — it's a method call, not an event broadcast,
-- so we can't intercept it through the normal plugin event chain.
-- Instead we patch the method on the per-document `ReaderMenu` instance
-- when the open document is a Pilcrow article. The instance dies with
-- the reader, so the override is self-cleaning.
------------------------------------------------------------------------

function Pilcrow:_currentArticleId()
    if not self.ui or not self.ui.document then return nil end
    return parse_id_from_path(self.ui.document.file
        or self.ui.document.filename or "")
end

function Pilcrow:_maybeInstallTopTapOverride()
    if not self.settings:get("pilcrow_top_menu") then return end
    if not self.ui or not self.ui.menu or not self.ui.document then return end
    local id = self:_currentArticleId()
    if not id or not self.cache:get(id) then return end

    local menu = self.ui.menu
    -- Idempotent — re-init shouldn't double-wrap.
    if menu._pilcrow_orig_onTapShowMenu then return end
    menu._pilcrow_orig_onTapShowMenu = menu.onTapShowMenu

    local pilcrow = self
    menu.onTapShowMenu = function(self_menu, ges)
        pilcrow:_showReaderActionSheet(self_menu, ges)
        return true
    end
end

--- Action sheet shown when the user taps the top of a Pilcrow article.
-- Mirrors `_showEndOfArticleActions` but called mid-read, so it offers
-- mark-as-read rather than assuming the end-of-book context, and keeps
-- an explicit escape hatch to the standard KOReader menu.
function Pilcrow:_showReaderActionSheet(reader_menu, ges)
    local id = self:_currentArticleId()
    local article = id and self.cache:get(id) or nil
    if not article then
        -- Document went away or cache lost it — fall back to native menu.
        if reader_menu and reader_menu._pilcrow_orig_onTapShowMenu then
            reader_menu._pilcrow_orig_onTapShowMenu(reader_menu, ges)
        end
        return
    end

    local dialog
    local star_label    = article.is_starred  and _("★ Unstar") or _("☆ Star")
    local archive_label = article.is_archived and _("◯ Mark as unread")
                                              or _("✓ Mark as read")

    local buttons = {
        {{ text = _("← Back to queue"),
           callback = function() UIManager:close(dialog); self:_returnToQueue() end }},
        {{ text = archive_label,
           callback = function()
               UIManager:close(dialog)
               self:handleRowAction("toggle_archive", article)
           end }},
        {{ text = star_label,
           callback = function()
               UIManager:close(dialog)
               self:handleRowAction("toggle_star", article)
           end }},
        {{ text = _("Copy URL"),
           callback = function()
               UIManager:close(dialog)
               self:handleRowAction("copy_url", article)
           end }},
    }

    buttons[#buttons + 1] = {{
        text = _("Summarize article"),
        callback = function()
            UIManager:close(dialog)
            self:showSummary(article)
        end,
    }}

    if self:_articleHasProgress(article) then
        buttons[#buttons + 1] = {{
            text = _("Clear reading progress"),
            callback = function()
                UIManager:close(dialog)
                self:_clearArticleProgress(article)
            end,
        }}
    end

    if self.client.supports_reload then
        buttons[#buttons + 1] = {{
            text = _("↻ Refetch from server"),
            callback = function()
                UIManager:close(dialog)
                self:_refetchArticle(article)
            end,
        }}
    end

    buttons[#buttons + 1] = {{
        text = _("KOReader menu…"),
        callback = function()
            UIManager:close(dialog)
            -- Pass through to the original handler. We deliberately
            -- forward the gesture so KOReader picks the correct tab
            -- (top-edge taps map to specific tabs per screen region).
            if reader_menu and reader_menu._pilcrow_orig_onTapShowMenu then
                reader_menu._pilcrow_orig_onTapShowMenu(reader_menu, ges)
            end
        end,
    }}
    buttons[#buttons + 1] = {{
        text = _("Stay on article"),
        callback = function() UIManager:close(dialog) end,
    }}

    dialog = ButtonDialog:new{
        title = article.title and article.title ~= "" and article.title
                or _("Pilcrow article"),
        title_align = "center",
        buttons = buttons,
    }
    UIManager:show(dialog)
end

function Pilcrow:onEndOfBook()
    if not self.ui or not self.ui.document then return end
    local file = self.ui.document.file or self.ui.document.filename
    local id = parse_id_from_path(file or "")
    if not id then return end

    local article = self.cache:get(id)
    if not article or article.is_archived or article.finished then return end

    -- Close KOReader's default end-of-document pop-up if ReaderStatus
    -- popped it before us. Our plugin sits downstream in the propagation
    -- chain (modules run before plugins), so it has already painted by
    -- the time we get here. Replacing it with our own action panel
    -- gives the user article-specific actions (mark read, star, copy
    -- URL, back to queue) instead of the generic file-manipulation menu.
    local top = UIManager:getTopmostVisibleWidget()
    if top and top.name == "end_document" then
        UIManager:close(top)
    end

    self:_showEndOfArticleActions(article)
    return true  -- swallow further propagation
end

function Pilcrow:_showEndOfArticleActions(article)
    local mode = self.settings:get("finish_prompt_mode") or "ask"

    -- Auto modes skip the dialog.
    if mode == "always" then
        if not article.is_archived and not article.finished then
            self:_markFinished(article)
        end
        self:_returnToQueueAfterClose()
        return
    end
    if mode == "never" then
        self:_returnToQueueAfterClose()
        return
    end

    -- Ask mode: rich article-actions dialog.
    local already_done = article.is_archived or article.finished
    local star_label = article.is_starred and _("★ Unstar") or _("☆ Star")

    local dialog
    local buttons = {}

    if not already_done then
        buttons[#buttons + 1] = {{
            text = _("✓ Mark as read"),
            callback = function()
                UIManager:close(dialog)
                self:_markFinished(article)
                self:_returnToQueueAfterClose()
            end,
        }}
    end

    buttons[#buttons + 1] = {{
        text = star_label,
        callback = function()
            UIManager:close(dialog)
            local toggled = not article.is_starred
            local ok = self.client:starEntry(article.id, toggled)
            if ok then
                self.cache:setFlag(article.id, "is_starred", toggled)
                self.cache:save()
            end
            self:_returnToQueueAfterClose()
        end,
    }}

    if self.client.supports_reload then
        buttons[#buttons + 1] = {{
            text = _("↻ Refetch from server"),
            callback = function()
                UIManager:close(dialog)
                self:_refetchArticle(article)
            end,
        }}
    end

    buttons[#buttons + 1] = {{
        text = _("Copy URL"),
        callback = function()
            UIManager:close(dialog)
            if article.url and article.url ~= ""
               and Device.input and Device.input.setClipboardText then
                Device.input.setClipboardText(article.url)
                UIManager:show(InfoMessage:new{
                    text = T(_("Copied: %1"), article.url), timeout = 2,
                })
            end
        end,
    }}

    buttons[#buttons + 1] = {{
        text = _("← Back to queue"),
        callback = function()
            UIManager:close(dialog)
            self:_returnToQueueAfterClose()
        end,
    }}

    buttons[#buttons + 1] = {{
        text = _("Stay on article"),
        callback = function() UIManager:close(dialog) end,
    }}

    dialog = ButtonDialog:new{
        -- Keep the same `name` so any retry path in ReaderStatus's
        -- top-widget check sees our dialog as the end_document widget.
        name = "end_document",
        title = T(_("End of: %1"), article.title or _("(untitled)")),
        title_align = "center",
        buttons = buttons,
    }
    UIManager:show(dialog)
end

function Pilcrow:_markFinished(article)
    self.cache:setFlag(article.id, "finished", true)
    self.cache:save()

    if not NetworkMgr:isOnline() then
        UIManager:show(InfoMessage:new{
            text = _("Marked locally; will sync next time you're online."),
            timeout = 2,
        })
        return
    end

    if self.client:archiveEntry(article.id) then
        self.cache:setFlag(article.id, "is_archived", true)
        self.cache:save()
    else
        UIManager:show(InfoMessage:new{
            text = _("Could not archive on server; will retry next sync."),
            timeout = 2,
        })
    end
end

--- True when KOReader has a sidecar (i.e. the article has been opened
-- at least once). Used by the row menu / reader sheet to gate the
-- "Clear progress" action — nothing to clear otherwise.
function Pilcrow:_articleHasProgress(article)
    if not article then return false end
    if article.finished then return true end
    local path = article.local_path
    if not path or path == "" then return false end
    if lfs.attributes(path, "mode") ~= "file" then return false end
    return DocSettings:hasSidecarFile(path)
end

--- Reset reading progress for a Pilcrow article — sidecar percent
-- and status — without touching annotations or bookmarks. The cache's
-- `finished` flag is cleared too, so a "marked read locally" article
-- is restored to "unread" client-side. The server's archive state is
-- left alone (delete sets that; this is a softer client-only reset).
function Pilcrow:_clearArticleProgress(article)
    if not article then return end
    local path = article.local_path
    local touched_sidecar = false
    if path and path ~= ""
       and lfs.attributes(path, "mode") == "file"
       and DocSettings:hasSidecarFile(path) then
        local doc_settings = DocSettings:open(path)
        if doc_settings then
            doc_settings:saveSetting("percent_finished", 0)
            local summary = doc_settings:readSetting("summary") or {}
            -- "reading" + 0% is KOReader's "fresh book" pair.
            summary.status = "reading"
            doc_settings:saveSetting("summary", summary)
            -- Clear last_xpointer too so the reader opens at the start
            -- next time, not the page the user left off on.
            doc_settings:saveSetting("last_xpointer", nil)
            doc_settings:flush()
            touched_sidecar = true
        end
    end

    if article.finished then
        self.cache:setFlag(article.id, "finished", false)
        self.cache:save()
    end
    -- In-progress memo is keyed on the same sidecar state we just
    -- mutated; bust it so the next list refresh recomputes.
    if self.cache.invalidateProgress then
        self.cache:invalidateProgress(article.id)
    end

    UIManager:show(InfoMessage:new{
        text = touched_sidecar and _("Reading progress cleared.")
                                or _("Nothing to clear."),
        timeout = 2,
    })
end

--- Ask Wallabag to re-fetch the article's contents from its source.
--  Best-effort: if the network or server refuses, we surface an
--  InfoMessage and stay where we are. On success we refresh the
--  cached metadata, drop the stale local EPUB + preview, and return
--  to the queue — the next tap on the article re-downloads with the
--  fresh content.
function Pilcrow:_refetchArticle(article)
    if not self.client.supports_reload then
        UIManager:show(InfoMessage:new{
            text = _("Refetch is not supported by this backend."), timeout = 2,
        })
        return
    end
    if not NetworkMgr:isOnline() then
        UIManager:show(InfoMessage:new{
            text = _("Refetching needs a network connection."), timeout = 2,
        })
        return
    end

    local info = InfoMessage:new{ text = _("Asking the server to re-fetch…") }
    UIManager:show(info)
    UIManager:forceRePaint()

    local ok, refreshed, http_code = self.client:reloadEntry(article.id)
    UIManager:close(info)

    if not ok then
        local hint = ""
        if refreshed == "http_error" and http_code then
            hint = "\n\n" .. (
                http_code == 304 and _("Wallabag refused: same content as before (HTTP 304).")
                or http_code == 403 and _("Permission denied (HTTP 403).")
                or http_code == 404 and _("Reload endpoint not found (HTTP 404).\nYour Wallabag may be too old.")
                or http_code == 500 and _("Server error (HTTP 500): the source URL probably can't be re-fetched right now.")
                or T(_("HTTP %1"), http_code)
            )
        end
        UIManager:show(InfoMessage:new{
            text = T(_("Refetch failed: %1%2"), tostring(refreshed), hint),
        })
        return
    end

    -- Update cache with refreshed metadata (title / domain / preview /…).
    if type(refreshed) == "table" and refreshed.id then
        self.cache:upsertFromApi(refreshed)
    end

    -- Drop the stale EPUB and image so the next open re-downloads.
    if article.local_path and lfs.attributes(article.local_path, "mode") == "file" then
        os.remove(article.local_path)
    end
    self.cache:setFlag(article.id, "local_path", nil)
    self.cache:setFlag(article.id, "summary_in_epub", nil)
    self:_pruneImageFor(article.id)
    self.cache:setFlag(article.id, "image_path", nil)
    self.cache:save()

    UIManager:show(InfoMessage:new{
        text = _("Article refreshed. Reopen it to read the new content."),
        timeout = 3,
    })
    self:_returnToQueueAfterClose()
end

--- Close the reader and reopen the queue.
-- Sets a class-level flag picked up by the FileManager-side plugin
-- instance's `init`, then triggers `ReaderUI:onHome()` (which closes
-- the reader and shows the file manager). The flag survives across
-- the two plugin instances because it lives on the class table.
-- No-op when called outside the reader, or when the user has opted
-- out via the `return_to_queue_on_finish` setting.
function Pilcrow:_returnToQueueAfterClose()
    if not self.settings:get("return_to_queue_on_finish") then return end
    self:_returnToQueue()
end

--- Unconditional version of `_returnToQueueAfterClose`. Called from
-- explicit user actions (the "Pilcrow" hamburger entry inside the
-- reader, the "← Back to queue" button) where we ignore the
-- `return_to_queue_on_finish` opt-out — the user just told us they
-- want to go back, so we go back.
function Pilcrow:_returnToQueue()
    if not self.ui or not self.ui.onHome then return end
    Pilcrow._show_queue_after_close = true
    UIManager:nextTick(function()
        if self.ui and self.ui.onHome then self.ui:onHome() end
    end)
end

return Pilcrow
