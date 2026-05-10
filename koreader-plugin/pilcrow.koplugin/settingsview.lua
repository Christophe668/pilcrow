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
    articles_per_sync       = 30,
    auto_sync_on_wifi       = true,    -- on by default; user can disable
    auto_sync_stale_minutes = 10,      -- skip auto-sync if cache fresher than this
    open_on_startup         = false,
    finish_prompt_mode      = "ask",   -- "ask" | "always" | "never"
    download_directory      = "",      -- empty -> default under data dir
    -- Image previews
    download_images         = true,
    -- Apply our bundled code-block CSS tweak to articles when opened.
    apply_code_style        = true,
    -- Return to the Pilcrow queue when an article reaches its end.
    return_to_queue_on_finish = true,
    -- Persisted filter state (queue view restores from these on launch)
    sort_key                = "newest",
    active_status           = "unread",
    active_tags             = {},
}

function Settings.open()
    local store = LuaSettings:open(DataStorage:getSettingsDir() .. "/" .. FILENAME)
    local data = store:readSetting(ROOT_KEY) or {}
    for k, v in pairs(DEFAULTS) do
        if data[k] == nil then data[k] = v end
    end
    store:saveSetting(ROOT_KEY, data)
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
end

function Settings:downloadDir()
    local configured = self:get("download_directory")
    if configured and configured ~= "" then return configured end
    return DataStorage:getDataDir() .. "/pilcrow/articles"
end

function Settings:imageDir()
    return DataStorage:getDataDir() .. "/pilcrow/images"
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

--- Open a button-dialog acting as a settings menu.
function Settings:show()
    local dialog
    local function rebuild()
        UIManager:close(dialog)
        self:show()
    end

    local prompt_mode = self:get("finish_prompt_mode")
    local rows = {
        {{ text = T(_("Articles per sync: %1"), self:get("articles_per_sync")),
           callback = function()
               show_string_input(_("Articles per sync"),
                   tostring(self:get("articles_per_sync")),
                   function(v)
                       local n = tonumber(v) or DEFAULTS.articles_per_sync
                       if n < 1 then n = 1 end
                       self:set("articles_per_sync", n)
                       rebuild()
                   end,
                   { numeric = true })
           end }},
        {{ text = self:get("auto_sync_on_wifi")
                  and _("✓ Auto-sync when WiFi is on")
                  or  _("☐ Auto-sync when WiFi is on"),
           callback = function()
               self:set("auto_sync_on_wifi", not self:get("auto_sync_on_wifi"))
               rebuild()
           end }},
        {{ text = self:get("download_images")
                  and _("✓ Download preview images during sync")
                  or  _("☐ Download preview images during sync"),
           callback = function()
               self:set("download_images", not self:get("download_images"))
               rebuild()
           end }},
        {{ text = self:get("apply_code_style")
                  and _("✓ Frame code blocks in opened articles")
                  or  _("☐ Frame code blocks in opened articles"),
           callback = function()
               self:set("apply_code_style", not self:get("apply_code_style"))
               rebuild()
           end }},
        {{ text = self:get("return_to_queue_on_finish")
                  and _("✓ Return to queue when article ends")
                  or  _("☐ Return to queue when article ends"),
           callback = function()
               self:set("return_to_queue_on_finish",
                        not self:get("return_to_queue_on_finish"))
               rebuild()
           end }},
        {{ text = T(_("Auto-sync if cache older than: %1 min"),
                    self:get("auto_sync_stale_minutes")),
           enabled = self:get("auto_sync_on_wifi") and true or false,
           callback = function()
               show_string_input(_("Stale threshold (minutes)"),
                   tostring(self:get("auto_sync_stale_minutes")),
                   function(v)
                       local n = tonumber(v) or DEFAULTS.auto_sync_stale_minutes
                       if n < 0 then n = 0 end
                       self:set("auto_sync_stale_minutes", n)
                       rebuild()
                   end,
                   { numeric = true })
           end }},
        {{ text = self:get("open_on_startup")
                  and _("✓ Open Pilcrow on startup")
                  or  _("☐ Open Pilcrow on startup"),
           callback = function()
               self:set("open_on_startup", not self:get("open_on_startup"))
               rebuild()
           end }},
        {{ text = T(_("Finish prompt: %1"), prompt_mode),
           callback = function()
               UIManager:close(dialog)
               self:_showFinishPromptModePicker()
           end }},
        {{ text = T(_("Download directory: %1"),
                    self:get("download_directory") ~= "" and self:get("download_directory")
                    or _("(default)")),
           callback = function()
               show_string_input(_("Download directory"),
                   self:get("download_directory") or "",
                   function(v)
                       self:set("download_directory", v)
                       rebuild()
                   end)
           end }},
        {{ text = _("Server & credentials are configured in the original Wallabag plugin."),
           enabled = false, callback = function() end }},
        {{ text = _("Show credentials path"),
           callback = function()
               UIManager:close(dialog)
               UIManager:show(InfoMessage:new{
                   text = T(_("Credentials are read from:\n%1/wallabag.lua"),
                            DataStorage:getSettingsDir()),
               })
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

function Settings:_showFinishPromptModePicker()
    local dialog
    local function pick(value)
        self:set("finish_prompt_mode", value)
        UIManager:close(dialog)
        self:show()
    end
    dialog = ButtonDialog:new{
        title = _("Finish-reading prompt"),
        title_align = "center",
        buttons = {
            {{ text = _("Ask each time"),    callback = function() pick("ask") end }},
            {{ text = _("Always mark read"), callback = function() pick("always") end }},
            {{ text = _("Never mark read"),  callback = function() pick("never") end }},
            {{ text = _("Cancel"),
               callback = function() UIManager:close(dialog) end }},
        },
    }
    UIManager:show(dialog)
end

return Settings
