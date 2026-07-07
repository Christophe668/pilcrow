--[[--
Settings panel for Pilcrow.

This panel ONLY shows plugin-local preferences (download dir, articles per
sync, auto-sync on wifi, finish prompt mode, startup-on-launch). For
server URL & credentials we direct the user to the original Wallabag
plugin's settings, since both share the same `wallabag.lua` file.

@module pilcrow.settingsview
--]]

local ButtonDialog = require("ui/widget/buttondialog")
local DataStorage = require("datastorage")
local Event = require("ui/event")
local InfoMessage = require("ui/widget/infomessage")
local InputDialog = require("ui/widget/inputdialog")
local LuaSettings = require("luasettings")
local UIManager = require("ui/uimanager")
local _ = require("gettext")
local T = require("ffi/util").template

local Settings = {}
Settings.__index = Settings

local FILENAME = "pilcrow.lua"
local ROOT_KEY = "pilcrow"

local DEFAULTS = {
    -- Which read-it-later service to talk to. "wallabag" preserves the
    -- v1 behaviour (read creds from wallabag.koplugin); "readeck" reads
    -- creds from `readeck.lua` under the settings dir.
    backend                 = "wallabag",
    articles_per_sync       = 30,
    auto_sync_on_wifi       = true,    -- on by default; user can disable
    auto_sync_stale_minutes = 10,      -- skip auto-sync if cache fresher than this
    open_on_startup         = false,
    finish_prompt_mode      = "ask",   -- "ask" | "always" | "never"
    download_directory      = "",      -- empty -> default under data dir
    -- Image previews
    download_images         = true,
    -- Download article epubs during sync so the queue is readable
    -- offline. Full syncs sweep everything missing; light auto-syncs
    -- only fetch newly arrived articles.
    download_articles       = true,
    -- Apply our bundled code-block CSS tweak to articles when opened.
    apply_code_style        = true,
    -- Return to the Pilcrow queue when an article reaches its end.
    return_to_queue_on_finish = true,
    -- Persisted filter state (queue view restores from these on launch)
    sort_key                = "newest",
    active_status           = "unread",
    active_tags             = {},
    -- When ON, tapping the top of a Pilcrow article opens a focused
    -- Pilcrow action sheet instead of KOReader's standard reader menu.
    -- The KOReader menu remains reachable from our sheet so the user
    -- never loses access to it.
    pilcrow_top_menu        = true,
    -- GitHub repo to pull releases from. Editable so a user on a fork
    -- can self-update from there. Format "owner/repo".
    update_repo             = "Christophe668/pilcrow",
    -- LLM article summaries (Settings → Summaries). Provider is either
    -- "anthropic" (Messages API) or "openai" (any /chat/completions-
    -- compatible endpoint: OpenAI, OpenRouter, Mistral, local Ollama…).
    summary_provider        = "anthropic",
    summary_anthropic_key   = "",
    summary_anthropic_model = "claude-haiku-4-5",
    summary_openai_base_url = "https://api.openai.com/v1",
    summary_openai_key      = "",
    summary_openai_model    = "gpt-4o-mini",
}

--- Stash the running plugin's directory + version on the module table
--- so the self-update menu can read them. main.lua is loaded via
--- `dofile` (not `require`) and the plugin root is dropped from
--- package.path right after init, so `require("main")` from here
--- silently returns nil. This module IS in package.loaded (it was
--- loaded with `require`), so module-level fields survive.
function Settings.setPluginInfo(dir, version)
    Settings._plugin_dir     = dir
    Settings._plugin_version = version
end

function Settings.open()
    local store = LuaSettings:open(DataStorage:getSettingsDir() .. "/" .. FILENAME)
    local data = store:readSetting(ROOT_KEY) or {}
    for k, v in pairs(DEFAULTS) do
        if data[k] == nil then data[k] = v end
    end
    store:saveSetting(ROOT_KEY, data)
    store:flush()
    return setmetatable({ store = store }, Settings)
end

function Settings:_data()
    return self.store:readSetting(ROOT_KEY) or {}
end

function Settings:get(key)
    return self:_data()[key]
end

function Settings:set(key, value)
    local d = self:_data()
    d[key] = value
    self.store:saveSetting(ROOT_KEY, d)
    -- LuaSettings buffers in memory until flush — without this the
    -- value survives the current session but is lost on relaunch.
    self.store:flush()
end

--- Per-backend folder suffix so Wallabag and Readeck downloads/images
--- don't share filenames in the same directory.
function Settings:_backendSubdir()
    if self:get("backend") == "readeck" then return "readeck-" end
    return ""
end

function Settings:downloadDir()
    local configured = self:get("download_directory")
    if configured and configured ~= "" then return configured end
    return DataStorage:getDataDir() .. "/pilcrow/" .. self:_backendSubdir() .. "articles"
end

function Settings:imageDir()
    return DataStorage:getDataDir() .. "/pilcrow/" .. self:_backendSubdir() .. "images"
end

--- Resolved summary-provider config for summarizer.build_request.
function Settings:summaryConfig()
    if self:get("summary_provider") == "openai" then
        return {
            provider = "openai",
            api_key  = self:get("summary_openai_key"),
            model    = self:get("summary_openai_model"),
            base_url = self:get("summary_openai_base_url"),
        }
    end
    return {
        provider = "anthropic",
        api_key  = self:get("summary_anthropic_key"),
        model    = self:get("summary_anthropic_model"),
    }
end

------------------------------------------------------------------------
-- UI
------------------------------------------------------------------------

local function show_string_input(title, current, on_save, opts)
    opts = opts or {}
    local dialog
    dialog = InputDialog:new{
        title = title,
        input = current or "",
        input_type = opts.numeric and "number" or nil,
        buttons = {{
            { text = _("Cancel"), id = "close",
              callback = function() UIManager:close(dialog) end },
            { text = _("Save"), is_enter_default = true,
              callback = function()
                  local v = dialog:getInputText() or ""
                  UIManager:close(dialog)
                  on_save(v)
              end },
        }},
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

local BACKEND_LABELS = {
    wallabag = _("Wallabag"),
    readeck  = _("Readeck"),
}

--- Helpers for the section sub-menus
--
-- ButtonDialog has no concept of grouping, so we model the settings
-- panel as a tree of mini-dialogs: a top-level menu with section
-- entries, each of which opens a focused list of related toggles +
-- inputs. Sub-screens return to the top via "← Back".

local function check_label(on, text)
    return (on and _("✓ ") or _("☐ ")) .. text
end

function Settings:_toggleRow(key, label)
    return {{
        text = check_label(self:get(key), label),
        callback = function()
            self:set(key, not self:get(key))
            self:_currentRebuild()
        end,
    }}
end

function Settings:_numericRow(key, label, prompt, default, min)
    return {{
        text = T(label .. ": %1", self:get(key)),
        callback = function()
            show_string_input(prompt,
                tostring(self:get(key)),
                function(v)
                    local n = tonumber(v) or default
                    if min and n < min then n = min end
                    self:set(key, n)
                    self:_currentRebuild()
                end,
                { numeric = true })
        end,
    }}
end

--- Open the top-level settings menu.
function Settings:show()
    self:_showTop()
end

function Settings:_showTop()
    local dialog
    self._currentRebuild = function()
        UIManager:close(dialog)
        self:_showTop()
    end

    local backend_kind  = self:get("backend") or "wallabag"
    local backend_label = BACKEND_LABELS[backend_kind] or backend_kind

    local rows = {
        {{ text = T(_("Backend: %1 →"), backend_label),
           callback = function()
               UIManager:close(dialog)
               self:_showBackendPicker()
           end }},
        {{ text = _("Account & credentials →"),
           callback = function()
               UIManager:close(dialog)
               self:_showAccountSection()
           end }},
        {{ text = _("Sync →"),
           callback = function()
               UIManager:close(dialog)
               self:_showSyncSection()
           end }},
        {{ text = _("Reading →"),
           callback = function()
               UIManager:close(dialog)
               self:_showReadingSection()
           end }},
        {{ text = _("Summaries →"),
           callback = function()
               UIManager:close(dialog)
               self:_showSummariesSection()
           end }},
        {{ text = _("Advanced →"),
           callback = function()
               UIManager:close(dialog)
               self:_showAdvancedSection()
           end }},
        {{ text = _("About & updates →"),
           callback = function()
               UIManager:close(dialog)
               self:_showAboutSection()
           end }},
        {{ text = _("Close"),
           callback = function() UIManager:close(dialog) end }},
    }

    dialog = ButtonDialog:new{
        title = _("Pilcrow settings"),
        title_align = "center",
        buttons = rows,
    }
    UIManager:show(dialog)
end

function Settings:_showSyncSection()
    local dialog
    self._currentRebuild = function()
        UIManager:close(dialog)
        self:_showSyncSection()
    end

    local stale_row = self:_numericRow(
        "auto_sync_stale_minutes",
        _("Stale threshold"), _("Stale threshold (minutes)"),
        DEFAULTS.auto_sync_stale_minutes, 0)
    -- Stale threshold only matters when auto-sync is on.
    stale_row[1].enabled = self:get("auto_sync_on_wifi") and true or false

    dialog = ButtonDialog:new{
        title = _("Sync"),
        title_align = "center",
        buttons = {
            self:_numericRow("articles_per_sync",
                _("Articles per sync"), _("Articles per sync"),
                DEFAULTS.articles_per_sync, 1),
            self:_toggleRow("auto_sync_on_wifi", _("Auto-sync when WiFi is on")),
            stale_row,
            self:_toggleRow("download_articles", _("Download articles during sync (read offline)")),
            self:_toggleRow("download_images", _("Download preview images during sync")),
            {{ text = _("← Back"),
               callback = function() UIManager:close(dialog); self:_showTop() end }},
        },
    }
    UIManager:show(dialog)
end

function Settings:_showReadingSection()
    local dialog
    self._currentRebuild = function()
        UIManager:close(dialog)
        self:_showReadingSection()
    end

    dialog = ButtonDialog:new{
        title = _("Reading"),
        title_align = "center",
        buttons = {
            self:_toggleRow("apply_code_style", _("Frame code blocks in opened articles")),
            self:_toggleRow("return_to_queue_on_finish", _("Return to queue when article ends")),
            self:_toggleRow("pilcrow_top_menu", _("Pilcrow menu on top-tap (in Pilcrow articles)")),
            {{ text = T(_("Finish prompt: %1"), self:get("finish_prompt_mode")),
               callback = function()
                   UIManager:close(dialog)
                   self:_showFinishPromptModePicker()
               end }},
            {{ text = _("← Back"),
               callback = function() UIManager:close(dialog); self:_showTop() end }},
        },
    }
    UIManager:show(dialog)
end

function Settings:_showSummariesSection()
    local dialog
    self._currentRebuild = function()
        UIManager:close(dialog)
        self:_showSummariesSection()
    end

    local provider = self:get("summary_provider") or "anthropic"
    local function masked(key)
        local v = self:get(key) or ""
        if v == "" then return _("(not set)") end
        return v:sub(1, 8) .. "…"
    end

    local rows = {
        {{ text = T(_("Provider: %1"), provider == "openai"
                and _("OpenAI-compatible") or _("Anthropic")),
           callback = function()
               self:set("summary_provider",
                   provider == "openai" and "anthropic" or "openai")
               self:_currentRebuild()
           end }},
    }

    if provider == "openai" then
        rows[#rows + 1] = {{
            text = T(_("Base URL: %1"), self:get("summary_openai_base_url") or ""),
            callback = function()
                show_string_input(_("OpenAI-compatible base URL"),
                    self:get("summary_openai_base_url"),
                    function(v) self:set("summary_openai_base_url", v); self:_currentRebuild() end)
            end }}
        rows[#rows + 1] = {{
            text = T(_("API key: %1"), masked("summary_openai_key")),
            callback = function()
                show_string_input(_("API key"),
                    self:get("summary_openai_key"),
                    function(v) self:set("summary_openai_key", v); self:_currentRebuild() end)
            end }}
        rows[#rows + 1] = {{
            text = T(_("Model: %1"), self:get("summary_openai_model") or ""),
            callback = function()
                show_string_input(_("Model name"),
                    self:get("summary_openai_model"),
                    function(v) self:set("summary_openai_model", v); self:_currentRebuild() end)
            end }}
    else
        rows[#rows + 1] = {{
            text = T(_("API key: %1"), masked("summary_anthropic_key")),
            callback = function()
                show_string_input(_("Anthropic API key"),
                    self:get("summary_anthropic_key"),
                    function(v) self:set("summary_anthropic_key", v); self:_currentRebuild() end)
            end }}
        rows[#rows + 1] = {{
            text = T(_("Model: %1"), self:get("summary_anthropic_model") or ""),
            callback = function()
                show_string_input(_("Model name"),
                    self:get("summary_anthropic_model"),
                    function(v) self:set("summary_anthropic_model", v); self:_currentRebuild() end)
            end }}
    end

    rows[#rows + 1] = {{ text = _("← Back"),
        callback = function()
            UIManager:close(dialog)
            self:_showTop()
        end }}

    dialog = ButtonDialog:new{
        title = _("Summaries"),
        title_align = "center",
        buttons = rows,
    }
    UIManager:show(dialog)
end

function Settings:_showAccountSection()
    local dialog
    local backend_kind = self:get("backend") or "wallabag"
    self._currentRebuild = function()
        UIManager:close(dialog)
        self:_showAccountSection()
    end

    local rows = {}
    if backend_kind == "readeck" then
        rows[#rows + 1] = {{
            text = _("Readeck server & token…"),
            callback = function()
                UIManager:close(dialog)
                self:_showReadeckCreds()
            end,
        }}
        rows[#rows + 1] = {{
            text = _("Show credentials path"),
            callback = function()
                UIManager:close(dialog)
                UIManager:show(InfoMessage:new{
                    text = T(_("Credentials are read from:\n%1/readeck.lua"),
                             DataStorage:getSettingsDir()),
                })
            end,
        }}
    else
        rows[#rows + 1] = {{
            text = _("Configured in the original Wallabag plugin"),
            enabled = false, callback = function() end,
        }}
        rows[#rows + 1] = {{
            text = _("Show credentials path"),
            callback = function()
                UIManager:close(dialog)
                UIManager:show(InfoMessage:new{
                    text = T(_("Credentials are read from:\n%1/wallabag.lua"),
                             DataStorage:getSettingsDir()),
                })
            end,
        }}
    end
    rows[#rows + 1] = {{
        text = _("← Back"),
        callback = function() UIManager:close(dialog); self:_showTop() end,
    }}

    dialog = ButtonDialog:new{
        title = _("Account & credentials"),
        title_align = "center",
        buttons = rows,
    }
    UIManager:show(dialog)
end

function Settings:_showAboutSection()
    local dialog
    self._currentRebuild = function()
        UIManager:close(dialog)
        self:_showAboutSection()
    end

    local current_version = Settings._plugin_version or "?"
    local repo = self:get("update_repo") or ""

    dialog = ButtonDialog:new{
        title = T(_("Pilcrow %1"), current_version),
        title_align = "center",
        buttons = {
            {{ text = T(_("GitHub repo: %1"), repo ~= "" and repo or _("(unset)")),
               callback = function()
                   show_string_input(_("GitHub repo (owner/name)"),
                       repo,
                       function(v)
                           self:set("update_repo", (v or ""):gsub("^%s+", ""):gsub("%s+$", ""))
                           self:_currentRebuild()
                       end)
               end }},
            {{ text = _("Check for updates"),
               callback = function()
                   UIManager:close(dialog)
                   self:_checkForUpdates()
               end }},
            {{ text = _("← Back"),
               callback = function() UIManager:close(dialog); self:_showTop() end }},
        },
    }
    UIManager:show(dialog)
end

function Settings:_checkForUpdates()
    local SelfUpdate = require("selfupdate")
    local current = Settings._plugin_version or "0.0.0"
    local repo = self:get("update_repo") or ""
    if repo == "" then
        UIManager:show(InfoMessage:new{
            text = _("Set a GitHub repo first (Settings → About & updates)."),
            timeout = 3,
        })
        return
    end

    local checking = InfoMessage:new{ text = _("Checking for updates…") }
    UIManager:show(checking)
    UIManager:forceRePaint()

    local ok, release_or_err = SelfUpdate.fetchLatestRelease(repo)
    UIManager:close(checking)

    if not ok then
        UIManager:show(InfoMessage:new{
            text = T(_("Update check failed: %1"), tostring(release_or_err)),
        })
        return
    end

    local latest = release_or_err.tag_name or release_or_err.name or ""
    local cmp = SelfUpdate.compareVersions(current, latest)
    if cmp >= 0 then
        UIManager:show(InfoMessage:new{
            text = T(_("Pilcrow is up to date (%1)."), current),
            timeout = 3,
        })
        return
    end

    local ConfirmBox = require("ui/widget/confirmbox")
    UIManager:show(ConfirmBox:new{
        text = T(_("Update available: %1 → %2.\nDownload and install now?"),
                 current, latest),
        ok_text = _("Install"),
        ok_callback = function() self:_applyUpdate(release_or_err) end,
    })
end

function Settings:_applyUpdate(release)
    local SelfUpdate = require("selfupdate")
    local plugin_dir = Settings._plugin_dir
    if not plugin_dir or plugin_dir == "" then
        UIManager:show(InfoMessage:new{
            text = _("Could not locate the plugin directory."), timeout = 3,
        })
        return
    end

    local working = InfoMessage:new{ text = _("Downloading update…") }
    UIManager:show(working)
    UIManager:forceRePaint()

    local ok, err = SelfUpdate.applyUpdate(release, plugin_dir)
    UIManager:close(working)

    if not ok then
        UIManager:show(InfoMessage:new{
            text = T(_("Update failed: %1"), tostring(err)),
        })
        return
    end

    local ConfirmBox = require("ui/widget/confirmbox")
    UIManager:show(ConfirmBox:new{
        text = _("Update installed. Restart KOReader now?"),
        ok_text = _("Restart"),
        ok_callback = function()
            local Event = require("ui/event")
            UIManager:broadcastEvent(Event:new("Restart"))
        end,
    })
end

function Settings:_showAdvancedSection()
    local dialog
    self._currentRebuild = function()
        UIManager:close(dialog)
        self:_showAdvancedSection()
    end

    dialog = ButtonDialog:new{
        title = _("Advanced"),
        title_align = "center",
        buttons = {
            self:_toggleRow("open_on_startup", _("Open Pilcrow on startup")),
            {{ text = T(_("Download directory: %1"),
                        self:get("download_directory") ~= "" and self:get("download_directory")
                        or _("(default)")),
               callback = function()
                   show_string_input(_("Download directory"),
                       self:get("download_directory") or "",
                       function(v)
                           self:set("download_directory", v)
                           self:_currentRebuild()
                       end)
               end }},
            {{ text = _("← Back"),
               callback = function() UIManager:close(dialog); self:_showTop() end }},
        },
    }
    UIManager:show(dialog)
end

--- Two-row picker for the backend. Switching mutates `pilcrow.lua`
--- only; the caller is responsible for reopening the queue (so cache
--- and client get rebuilt against the new backend).
function Settings:_showBackendPicker()
    local dialog
    local current = self:get("backend") or "wallabag"
    local function pick(value)
        UIManager:close(dialog)
        if value == current then self:show(); return end
        self:set("backend", value)
        -- Notify main.lua so it can rebuild cache+client and refresh
        -- the visible queue without requiring a manual close/reopen.
        UIManager:broadcastEvent(Event:new("PilcrowBackendChanged", value))
        UIManager:show(InfoMessage:new{
            text = T(_("Switched to %1."),
                     BACKEND_LABELS[value] or value),
            timeout = 2,
        })
    end
    local rows = {}
    for _, key in ipairs({ "wallabag", "readeck" }) do
        local label = BACKEND_LABELS[key] or key
        if key == current then label = "▸ " .. label end
        rows[#rows + 1] = {{ text = label, callback = function() pick(key) end }}
    end
    rows[#rows + 1] = {{ text = _("Cancel"),
                         callback = function() UIManager:close(dialog); self:show() end }}
    dialog = ButtonDialog:new{
        title = _("Backend"), title_align = "center", buttons = rows,
    }
    UIManager:show(dialog)
end

--- Tiny editor for the two Readeck credentials we need. The file is
--- shared with no other plugin, so we own the schema.
function Settings:_showReadeckCreds()
    local ReadeckClient = require("readeckclient")
    local client = ReadeckClient.new()
    local function reopen() self:show() end

    local function editField(key, prompt, current)
        show_string_input(prompt, current or "", function(v)
            local creds = {
                server_url   = client:get("server_url") or "",
                access_token = client:get("access_token") or "",
            }
            creds[key] = v:gsub("^%s+", ""):gsub("%s+$", "")
            -- Strip a trailing slash and default to https:// when the
            -- user enters a bare hostname — luasocket needs an
            -- explicit scheme to dispatch.
            if key == "server_url" then
                creds.server_url = creds.server_url:gsub("/+$", "")
                if creds.server_url ~= ""
                   and not creds.server_url:match("^https?://") then
                    creds.server_url = "https://" .. creds.server_url
                end
            end
            client:saveCreds(creds)
            self:_showReadeckCreds()
        end)
    end

    local dialog
    local function close_and(callback) UIManager:close(dialog); callback() end

    local server = client:get("server_url") or ""
    local token  = client:get("access_token") or ""
    local function masked(s)
        if not s or s == "" then return _("(empty)") end
        if #s <= 8 then return string.rep("•", #s) end
        return string.rep("•", #s - 4) .. s:sub(-4)
    end

    dialog = ButtonDialog:new{
        title = _("Readeck credentials"),
        title_align = "center",
        buttons = {
            {{ text = T(_("Server URL: %1"),
                        server ~= "" and server or _("(empty)")),
               callback = function() close_and(function()
                   editField("server_url", _("Server URL (e.g. https://readeck.example.com)"), server)
               end) end }},
            {{ text = T(_("Access token: %1"), masked(token)),
               callback = function() close_and(function()
                   editField("access_token", _("Bearer access token"), token)
               end) end }},
            {{ text = _("Close"),
               callback = function() close_and(reopen) end }},
        },
    }
    UIManager:show(dialog)
end

function Settings:_showFinishPromptModePicker()
    local dialog
    local function pick(value)
        self:set("finish_prompt_mode", value)
        UIManager:close(dialog)
        self:_showReadingSection()
    end
    dialog = ButtonDialog:new{
        title = _("Finish-reading prompt"),
        title_align = "center",
        buttons = {
            {{ text = _("Ask each time"),    callback = function() pick("ask") end }},
            {{ text = _("Always mark read"), callback = function() pick("always") end }},
            {{ text = _("Never mark read"),  callback = function() pick("never") end }},
            {{ text = _("Cancel"),
               callback = function()
                   UIManager:close(dialog); self:_showReadingSection()
               end }},
        },
    }
    UIManager:show(dialog)
end

return Settings
