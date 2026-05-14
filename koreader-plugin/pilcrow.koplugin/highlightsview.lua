--[[--
Pilcrow Highlights view.

A flat list of every server-side annotation across the user's Pilcrow
library, regardless of which article it belongs to. Reads from the
cache's `server_annotations` field, which is populated by
`annotationsync.pullAll` during sync.

Each row is shaped as:

    Article title  ·  YYYY-MM-DD
    « quote »
    note (when present)

Tapping a row opens a popup with the full text — KOReader's article
list rows aren't tall enough to show a long quote inline. We do *not*
deep-link into the article and scroll to the highlight: KOReader's
highlight UI on the EPUB is the authoritative experience for that;
this view is for reviewing what you've highlighted across devices.

@module pilcrow.highlightsview
--]]

local InfoMessage = require("ui/widget/infomessage")
local Menu = require("ui/widget/menu")
local Screen = require("device").screen
local UIManager = require("ui/uimanager")
local _ = require("gettext")
local T = require("ffi/util").template

local AnnotationSync = require("annotationsync")

local function snippet(s, n)
    s = s or ""
    if #s <= n then return s end
    return s:sub(1, n - 1) .. "…"
end

local function short_date(iso)
    -- "2026-05-15T11:30:39Z" → "2026-05-15"; pass through anything else.
    if type(iso) ~= "string" then return "" end
    return iso:sub(1, 10)
end

local HighlightsView = Menu:extend{
    is_borderless       = true,
    covers_fullscreen   = true,
    title               = _("Pilcrow — Highlights"),
    title_bar_left_icon = "appbar.menu",
    title_bar_fm_style  = true,
    subtitle            = false,
    items_per_page      = 9,
    -- Injected by main.lua:
    cache = nil,
}

function HighlightsView:init()
    self.width  = self.width  or Screen:getWidth()
    self.height = self.height or Screen:getHeight()
    self.onLeftButtonTap = function() UIManager:close(self) end
    self.item_table = self:_buildItemTable()
    Menu.init(self)
end

function HighlightsView:_buildItemTable()
    local all = AnnotationSync.listAllForUI(self.cache)
    if #all == 0 then
        return { {
            text = _("No highlights yet — sync, or highlight something in an article."),
            dim = true,
        } }
    end

    -- Most-recent first. Falls back to the article id when the server
    -- didn't send a created timestamp.
    table.sort(all, function(a, b)
        if a.created ~= b.created then return (a.created or "") > (b.created or "") end
        return tostring(a.article_id) > tostring(b.article_id)
    end)

    local rows = {}
    for _, a in ipairs(all) do
        local title = a.article_title ~= "" and a.article_title or a.article_url
        local date  = short_date(a.created)
        local header = date ~= "" and (snippet(title, 50) .. "  ·  " .. date)
                              or  snippet(title, 60)
        local quote = "« " .. snippet(a.quote, 140) .. " »"
        local note  = a.note ~= "" and ("\n" .. snippet(a.note, 100)) or ""
        rows[#rows + 1] = {
            text = header .. "\n" .. quote .. note,
            mandatory = "",
            callback = function() self:_showFull(a) end,
        }
    end
    return rows
end

function HighlightsView:_showFull(a)
    local title = a.article_title ~= "" and a.article_title or a.article_url
    local lines = { title }
    if a.created and a.created ~= "" then
        lines[#lines + 1] = a.created
    end
    lines[#lines + 1] = ""
    lines[#lines + 1] = "« " .. (a.quote or "") .. " »"
    if a.note and a.note ~= "" then
        lines[#lines + 1] = ""
        lines[#lines + 1] = a.note
    end
    UIManager:show(InfoMessage:new{
        text = table.concat(lines, "\n"),
    })
end

function HighlightsView:reload()
    self:switchItemTable(self.title, self:_buildItemTable())
end

------------------------------------------------------------------------
-- Public open helper, called from main.lua
------------------------------------------------------------------------

local M = {}

function M.open(opts)
    local view = HighlightsView:new{
        cache = opts.cache,
    }
    UIManager:show(view)
    return view
end

M.HighlightsView = HighlightsView

return M
