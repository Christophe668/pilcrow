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
local UIManager = require("ui/uimanager")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local lfs = require("libs/libkoreader-lfs")
local logger = require("logger")
local _ = require("gettext")
local T = require("ffi/util").template

local STYLE_TWEAK_FILE = "wallabag-code.css"

local Cache = require("articlecache")
local QueueView = require("queueview")
local SettingsView = require("settingsview")
local WallabagClient = require("wallabagclient")

local Pilcrow = WidgetContainer:extend{
    name = "pilcrow",
    is_doc_only = false,
}

------------------------------------------------------------------------
-- Lifecycle
------------------------------------------------------------------------

function Pilcrow:init()
    self.cache    = Cache.open()
    self.client   = WallabagClient.new()
    self.settings = SettingsView.open()

    self:_ensureDownloadDir()
    self:_ensureStyleTweakInstalled()
    self:onDispatcherRegisterActions()
    if self.ui and self.ui.menu then
        self.ui.menu:registerToMainMenu(self)
    end

    -- Returning from the reader after an article ended? Reopen the queue.
    -- This flag is set by `_returnToQueueAfterClose` before the reader is
    -- closed; the file-manager-side plugin instance picks it up here.
    if Pilcrow._show_queue_after_close then
        Pilcrow._show_queue_after_close = false
        UIManager:nextTick(function() self:openQueue() end)
    -- Open on startup if configured (only the first FileManager bring-up).
    elseif self.settings:get("open_on_startup") and not Pilcrow._launched_once then
        Pilcrow._launched_once = true
        UIManager:nextTick(function() self:openQueue() end)
    end
end

function Pilcrow:onDispatcherRegisterActions()
    Dispatcher:registerAction("pilcrow_open", {
        category = "none",
        event    = "PilcrowOpen",
        title    = _("Open Wallabag queue"),
        general  = true,
    })
    Dispatcher:registerAction("pilcrow_sync", {
        category = "none",
        event    = "PilcrowSync",
        title    = _("Sync Wallabag queue"),
        general  = true,
    })
end

function Pilcrow:addToMainMenu(menu_items)
    menu_items.pilcrow = {
        text = _("Wallabag queue"),
        sorting_hint = "main",
        callback = function() self:openQueue() end,
    }
end

function Pilcrow:_ensureDir(dir)
    if not dir or dir == "" then return end
    if lfs.attributes(dir, "mode") == "directory" then return end
    local parent = dir:match("^(.*)/[^/]+$")
    if parent and lfs.attributes(parent, "mode") ~= "directory" then
        lfs.mkdir(parent)
    end
    lfs.mkdir(dir)
end

function Pilcrow:_ensureDownloadDir()
    self:_ensureDir(self.settings:downloadDir())
end

function Pilcrow:_ensureImageDir()
    self:_ensureDir(self.settings:imageDir())
end

local IMAGE_EXTENSIONS = { "jpg", "jpeg", "png", "gif", "bmp", "img" }

local function image_filename_for(id)
    -- KOReader's ImageWidget refuses paths whose extension isn't a known
    -- image format. .jpg is the safe default — most Wallabag preview_picture
    -- responses are JPEG. If the body turns out to be WebP/AVIF, MµPDF
    -- returns nil from renderImageFile and falls back to a checkerboard
    -- (no crash).
    return string.format("%d.jpg", id)
end

function Pilcrow:_imagePathFor(id)
    return self.settings:imageDir() .. "/" .. image_filename_for(id)
end

function Pilcrow:_pruneImageFor(id)
    -- Remove any cached preview, regardless of historical extension.
    local dir = self.settings:imageDir()
    for _, ext in ipairs(IMAGE_EXTENSIONS) do
        local p = string.format("%s/%d.%s", dir, id, ext)
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

function Pilcrow:openQueue()
    if self._queue and self._queue.show_parent then
        UIManager:show(self._queue)
        self:_maybeAutoSync()
        return
    end
    self._queue = QueueView:new{
        cache              = self.cache,
        settings           = self.settings,
        on_open_article    = function(article) self:openArticle(article) end,
        on_action          = function(action, article, refresh_cb)
            self:handleRowAction(action, article, refresh_cb)
        end,
        on_sync            = function(refresh_cb) self:syncNow(refresh_cb) end,
        on_open_settings   = function() self.settings:show() end,
    }
    UIManager:show(self._queue)
    self:_maybeAutoSync()
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
    UIManager:nextTick(function()
        self:syncNow(function()
            if self._queue then self._queue:reload() end
        end, { quiet = true })
    end)
end

function Pilcrow:onPilcrowOpen()
    self:openQueue()
    return true
end

function Pilcrow:onPilcrowSync()
    self:syncNow()
    return true
end

------------------------------------------------------------------------
-- Sync
------------------------------------------------------------------------

function Pilcrow:syncNow(refresh_cb, opts)
    opts = opts or {}
    local ok, missing = self.client:isConfigured()
    if not ok then
        if not opts.quiet then
            UIManager:show(InfoMessage:new{
                text = T(_("Wallabag is not configured (missing: %1).\nOpen the original Wallabag plugin's settings first."), missing),
            })
        end
        return
    end

    local kickoff = function()
        local info = InfoMessage:new{ text = _("Syncing Wallabag…") }
        UIManager:show(info)
        UIManager:forceRePaint()
        self:_doSync(function(summary)
            UIManager:close(info)
            if not opts.quiet then
                UIManager:show(InfoMessage:new{ text = summary, timeout = 3 })
            end
            if refresh_cb then refresh_cb() end
        end)
    end

    -- For an explicit sync we want to wait for connectivity; for an auto
    -- sync we silently skip if offline rather than nag the user.
    if opts.quiet and not NetworkMgr:isOnline() then return end
    if NetworkMgr:willRerunWhenOnline(kickoff) then return end
    kickoff()
end

function Pilcrow:_doSync(done_cb)
    local per_page = self.settings:get("articles_per_sync") or 30
    local ok, items_or_err = self.client:listEntries({
        archive  = 0,
        perPage  = per_page,
        maxItems = per_page,
    })
    if not ok then
        done_cb(T(_("Sync failed: %1"), tostring(items_or_err)))
        return
    end

    local seen = {}
    for _, api_article in ipairs(items_or_err) do
        self.cache:upsertFromApi(api_article)
        seen[api_article.id] = true
    end

    -- Also pull a page of starred articles so they appear in the Starred filter.
    local s_ok, starred = self.client:listEntries({
        archive = 0, starred = 1, perPage = per_page, maxItems = per_page,
    })
    if s_ok then
        for _, api_article in ipairs(starred) do
            self.cache:upsertFromApi(api_article)
            seen[api_article.id] = true
        end
    end

    -- Optionally fetch preview images. Best-effort: any failure is logged
    -- and we continue. This serializes downloads (Lua's HTTP client is
    -- blocking) but at most touches `articles_per_sync` images.
    local images_dl, images_skipped = 0, 0
    if self.settings:get("download_images") then
        self:_ensureImageDir()
        for id in pairs(seen) do
            local article = self.cache:get(id)
            if article and article.preview_picture and article.preview_picture ~= "" then
                local path = self:_imagePathFor(id)
                if lfs.attributes(path, "mode") == "file" then
                    -- already cached at the canonical .jpg path
                    if article.image_path ~= path then
                        self.cache:setFlag(id, "image_path", path)
                    end
                else
                    -- Sweep any legacy paths (e.g. old `.img` files) before
                    -- downloading the fresh canonical copy.
                    self:_pruneImageFor(id)
                    local ok = self.client:downloadUrl(article.preview_picture, path)
                    if ok then
                        self.cache:setFlag(id, "image_path", path)
                        images_dl = images_dl + 1
                    else
                        self.cache:setFlag(id, "image_path", nil)
                        images_skipped = images_skipped + 1
                    end
                end
            end
        end
    end

    self.cache:markSynced()
    self.cache:save()

    local count = 0
    for _ in pairs(seen) do count = count + 1 end
    local msg = T(_("Sync complete: %1 articles refreshed."), count)
    if images_dl + images_skipped > 0 then
        msg = msg .. " " .. T(_("(%1 images, %2 skipped)"), images_dl, images_skipped)
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

    if not NetworkMgr:isOnline() then
        UIManager:show(InfoMessage:new{
            text = _("This action needs network connectivity."), timeout = 2,
        })
        return
    end

    local id = article.id
    if action == "toggle_archive" then
        local ok = article.is_archived
            and self.client:unarchiveEntry(id)
            or  self.client:archiveEntry(id)
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
        local info = InfoMessage:new{ text = _("Asking Wallabag to re-fetch…") }
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
-- Opening articles
------------------------------------------------------------------------

local function safe_filename(id, title)
    local cleaned = (title or "untitled"):gsub("[%c/\\:%*%?\"<>|]", " ")
    cleaned = cleaned:gsub("%s+", " ")
    if #cleaned > 100 then cleaned = cleaned:sub(1, 100) end
    return string.format("[wr-id_%d] %s.epub", id, cleaned)
end

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

    local dir = self.settings:downloadDir()
    self:_ensureDownloadDir()
    local fpath = dir .. "/" .. safe_filename(article.id, article.title)

    local info = InfoMessage:new{ text = _("Downloading article…") }
    UIManager:show(info)
    UIManager:forceRePaint()

    local ok, err_or_path, http_code = self.client:downloadEntry(article.id, fpath, "epub")
    UIManager:close(info)
    if not ok then
        UIManager:show(InfoMessage:new{
            text = T(_("Download failed: %1 (HTTP %2)"),
                tostring(err_or_path), tostring(http_code or "?")),
        })
        return
    end

    self.cache:setLocalPath(article.id, fpath)
    self.cache:save()
    launch(fpath)
end

------------------------------------------------------------------------
-- Mark-on-finish prompt
------------------------------------------------------------------------

local function parse_id_from_path(path)
    if not path then return nil end
    local id = path:match("%[wr%-id_(%d+)%]")
    return id and tonumber(id) or nil
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

    buttons[#buttons + 1] = {{
        text = _("↻ Refetch from server"),
        callback = function()
            UIManager:close(dialog)
            self:_refetchArticle(article)
        end,
    }}

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

--- Ask Wallabag to re-fetch the article's contents from its source.
--  Best-effort: if the network or server refuses, we surface an
--  InfoMessage and stay where we are. On success we refresh the
--  cached metadata, drop the stale local EPUB + preview, and return
--  to the queue — the next tap on the article re-downloads with the
--  fresh content.
function Pilcrow:_refetchArticle(article)
    if not NetworkMgr:isOnline() then
        UIManager:show(InfoMessage:new{
            text = _("Refetching needs a network connection."), timeout = 2,
        })
        return
    end

    local info = InfoMessage:new{ text = _("Asking Wallabag to re-fetch…") }
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
    if not self.ui or not self.ui.onHome then return end
    Pilcrow._show_queue_after_close = true
    -- Defer one tick so any visible InfoMessage / ConfirmBox finishes
    -- closing before the reader teardown begins.
    UIManager:nextTick(function()
        if self.ui and self.ui.onHome then self.ui:onHome() end
    end)
end

return Pilcrow
