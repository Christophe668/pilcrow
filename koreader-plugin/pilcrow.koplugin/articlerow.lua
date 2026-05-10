--[[--
Article-row formatting helpers.

KOReader's `Menu` widget renders rows from plain item tables with `text`
and `mandatory` strings. Rather than build a custom MenuItem (and fight
the Menu layout pipeline), we format each row's left and right text
strings here.

Layout per row:
    [★] Title of the article                domain.tld · 7 min

The starred marker is prepended to title; the right side ("mandatory"
in Menu terms) carries domain and reading time.

@module pilcrow.articlerow
--]]

local _ = require("gettext")
local T = require("ffi/util").template

local M = {}

local STAR = "★ "
local UNREAD_DOT = "• "

local function reading_time_label(minutes)
    if not minutes or minutes <= 0 then return "" end
    if minutes < 60 then
        return T(_("%1 min"), minutes)
    end
    local h = math.floor(minutes / 60)
    local m = minutes % 60
    if m == 0 then return T(_("%1 h"), h) end
    return T(_("%1h %2m"), h, m)
end

local function right_meta(article)
    local parts = {}
    if article.domain and article.domain ~= "" then
        parts[#parts + 1] = article.domain
    end
    local rt = reading_time_label(article.reading_time)
    if rt ~= "" then parts[#parts + 1] = rt end
    return table.concat(parts, " · ")
end

local function title_text(article)
    local prefix = ""
    if article.is_starred then prefix = STAR end
    if not article.is_archived and not article.finished then
        prefix = prefix .. UNREAD_DOT
    end
    local title = article.title
    if not title or title == "" then title = _("(untitled)") end
    return prefix .. title
end

--- Format an article (cache row) into a Menu item table.
-- The full `article` table reference is attached so QueueView's custom
-- `updateItems` can hand it to ArticleCard for rendering. `text` and
-- `mandatory` are kept as fallbacks for code paths (or future Menu
-- variants) that don't know about ArticleCard.
-- @tparam table article cache row
-- @tparam[opt] table extra fields to merge (e.g. `callback`)
function M.format(article, extra)
    local item = {
        article    = article,
        article_id = article.id,
        text       = title_text(article),
        mandatory  = right_meta(article),
        bold       = (not article.is_archived) and (not article.finished),
    }
    if extra then
        for k, v in pairs(extra) do item[k] = v end
    end
    return item
end

M.STAR        = STAR
M.UNREAD_DOT  = UNREAD_DOT
M._readingTime = reading_time_label  -- exported for tests

return M
