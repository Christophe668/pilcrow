--[[--
Card-style row widget for the Pilcrow queue.

Layout (left to right, three body lines):

    +-----+ +--------------------------------------+ +-------+
    |     | | ★ Title of the article (1 line, …)  | |  45%  |
    | img | | domain.tld                           | | done  |
    |     | | 9 min · 2d ago                       | |       |
    +-----+ +--------------------------------------+ +-------+

Right column shows reading progress + status read from the article's
KOReader sidecar (if it has been opened): a percentage like "45%" for
in-flight reads, "done" for complete, "skipped" for abandoned. Articles
that were never opened render no right column and the body fills the
freed width.

The widget is paint-equivalent to a MenuItem from Menu's perspective —
same `dimen`, dispatches taps to `self.menu:onMenuSelect(self.entry)`
and holds to `self.menu:onMenuHold(self.entry)`. That keeps the rest of
Menu's machinery (focus, pagination, redraw) working unchanged.

@module pilcrow.articlecard
--]]

local Blitbuffer = require("ffi/blitbuffer")
local CenterContainer = require("ui/widget/container/centercontainer")
local DocSettings = require("docsettings")
local Font = require("ui/font")
local FrameContainer = require("ui/widget/container/framecontainer")
local Geom = require("ui/geometry")
local GestureRange = require("ui/gesturerange")
local HorizontalGroup = require("ui/widget/horizontalgroup")
local HorizontalSpan = require("ui/widget/horizontalspan")
local ImageWidget = require("ui/widget/imagewidget")
local InputContainer = require("ui/widget/container/inputcontainer")
local LineWidget = require("ui/widget/linewidget")
local RightContainer = require("ui/widget/container/rightcontainer")
local Screen = require("device").screen
local Size = require("ui/size")
local TextWidget = require("ui/widget/textwidget")
local VerticalGroup = require("ui/widget/verticalgroup")
local VerticalSpan = require("ui/widget/verticalspan")
local lfs = require("libs/libkoreader-lfs")
local logger = require("logger")
local _ = require("gettext")

-- 120 x 80 logical pixels @ native (Kobo 1264x1680) → comfortable hero-image preview.
local THUMB_W = Screen:scaleBySize(120)
local THUMB_H = Screen:scaleBySize(80)
-- Right column reserved for progress + status. Empty when no progress.
local RIGHT_COL_W = Screen:scaleBySize(72)

local ArticleCard = InputContainer:extend{
    -- Required
    entry = nil,            -- the menu item (carries article data via .article)
    menu  = nil,            -- parent Menu (for tap/hold dispatch)
    dimen = nil,            -- Geom; row size set by Menu:_recalculateDimen
    -- Optional
    show_parent = nil,
}

local KNOWN_IMAGE_EXT = {
    jpg  = true, jpeg = true,
    png  = true, gif  = true,
    bmp  = true, tif  = true, tiff = true,
    svg  = true,
}

local function known_image_extension(path)
    local ext = path:match("%.([%w]+)$")
    return ext and KNOWN_IMAGE_EXT[ext:lower()] or false
end

local function image_file_readable(path)
    if not path or path == "" then return false end
    if not known_image_extension(path) then return false end
    return lfs.attributes(path, "mode") == "file"
end

function ArticleCard:_buildThumbnail()
    local article = (self.entry and self.entry.article) or {}
    local box = FrameContainer:new{
        bordersize = Size.border.thin,
        padding = 0,
        margin = 0,
        background = Blitbuffer.COLOR_WHITE,
        dim = self.entry and self.entry.dim,
    }

    if image_file_readable(article.image_path) then
        local ok, widget = pcall(ImageWidget.new, ImageWidget, {
            file = article.image_path,
            width = THUMB_W,
            height = THUMB_H,
            scale_factor = 0,
            alpha = true,
            file_do_cache = false,
        })
        if ok and widget then
            box[1] = CenterContainer:new{
                dimen = Geom:new{ w = THUMB_W, h = THUMB_H },
                widget,
            }
            return box
        else
            logger.dbg("pilcrow: failed to render", article.image_path, widget)
        end
    end

    -- Placeholder glyph for articles without (or with un-decodable) preview.
    local placeholder = TextWidget:new{
        text = "📄",
        face = Font:getFace("smallinfofont"),
        fgcolor = Blitbuffer.COLOR_DARK_GRAY,
    }
    box[1] = CenterContainer:new{
        dimen = Geom:new{ w = THUMB_W, h = THUMB_H },
        placeholder,
    }
    return box
end

------------------------------------------------------------------------
-- Pure formatting helpers (exported for unit tests)
------------------------------------------------------------------------

local function format_age(created_at)
    if not created_at or created_at == "" then return "" end
    local y, m, d, hh, mm, ss = created_at:match("(%d+)-(%d+)-(%d+)T(%d+):(%d+):(%d+)")
    if not y then return "" end
    local ts = os.time({
        year = tonumber(y), month = tonumber(m), day = tonumber(d),
        hour = tonumber(hh), min = tonumber(mm), sec = tonumber(ss),
    })
    if not ts then return "" end
    local delta = os.time() - ts
    if delta < 60                then return _("just now") end
    if delta < 3600              then return string.format(_("%dm ago"), math.floor(delta/60)) end
    if delta < 86400             then return string.format(_("%dh ago"), math.floor(delta/3600)) end
    if delta < 86400 * 7         then return string.format(_("%dd ago"), math.floor(delta/86400)) end
    if delta < 86400 * 30        then return string.format(_("%dw ago"), math.floor(delta/(86400*7))) end
    if delta < 86400 * 365       then return string.format(_("%dmo ago"), math.floor(delta/(86400*30))) end
    return string.format(_("%dy ago"), math.floor(delta/(86400*365)))
end

local function reading_time_text(article)
    local rt = tonumber(article.reading_time) or 0
    if rt <= 0 then return "" end
    return string.format(_("%d min"), rt)
end

local function time_age_text(article)
    local parts = {}
    local rt = reading_time_text(article)
    if rt ~= "" then parts[#parts + 1] = rt end
    local age = format_age(article.created_at)
    if age ~= "" then parts[#parts + 1] = age end
    return table.concat(parts, " · ")
end

local function title_text(article)
    local prefix = article.is_starred and "★ " or ""
    local title = article.title or ""
    if title == "" then title = _("(untitled)") end
    return prefix .. title
end

--- Read reading-progress + status from the article's local sidecar.
--  Returns nil if the article was never opened.
local function read_progress(article)
    local path = article and article.local_path
    if not path or path == "" then return nil end
    if lfs.attributes(path, "mode") ~= "file" then return nil end
    if not DocSettings:hasSidecarFile(path) then return nil end
    local doc_settings = DocSettings:open(path)
    if not doc_settings then return nil end
    local summary = doc_settings:readSetting("summary") or {}
    local percent = tonumber(doc_settings:readSetting("percent_finished")) or 0
    return {
        percent = math.max(0, math.min(1, percent)),
        status  = summary.status,
    }
end

local function status_label(progress)
    if not progress or not progress.status then return "" end
    if progress.status == "complete"  then return _("done") end
    if progress.status == "abandoned" then return _("skipped") end
    return ""  -- "reading" / "new" / nil — the percentage carries the info
end

ArticleCard.STAR_GLYPH = "★ "
ArticleCard._formatAge       = format_age
ArticleCard._timeAgeText     = time_age_text
ArticleCard._titleText       = title_text
ArticleCard._readProgress    = read_progress
ArticleCard._statusLabel     = status_label

------------------------------------------------------------------------
-- Init: build the row widget tree
------------------------------------------------------------------------

function ArticleCard:init()
    self.dimen = self.dimen or Geom:new{ w = Screen:getWidth(), h = THUMB_H + Size.padding.large * 2 }
    local article = (self.entry and self.entry.article) or {}
    local h_pad = Size.padding.default
    local gap   = Size.padding.large

    local thumb = self:_buildThumbnail()

    -- Decide if a right column gets shown; it costs body width when present.
    local progress = read_progress(article)
    local right_col_visible = progress ~= nil and
        ((progress.percent and progress.percent > 0) or status_label(progress) ~= "")

    local right_col_w = right_col_visible and RIGHT_COL_W or 0
    local right_col_gap = right_col_visible and gap or 0

    local body_w = self.dimen.w
        - h_pad * 2
        - thumb:getSize().w
        - gap
        - right_col_gap
        - right_col_w

    local is_unread = (not article.is_archived) and (not article.finished)
    local title_face = is_unread and Font:getFace("cfont", 22)
                                  or  Font:getFace("cfont", 21)
    local meta_face  = Font:getFace("smallinfofont")
    local fg_dim     = self.entry.dim and Blitbuffer.COLOR_DARK_GRAY or Blitbuffer.COLOR_BLACK

    -- Title widget: single line, automatic ellipsis on overflow.
    -- Using TextWidget (rather than TextBoxWidget) keeps it simple —
    -- guaranteed single-line render, no internal blitbuffer cycle.
    local title_widget = TextWidget:new{
        text = title_text(article),
        face = title_face,
        bold = is_unread,
        max_width = body_w,
        truncate_with_ellipsis = true,
        fgcolor = fg_dim,
    }
    local domain_widget = TextWidget:new{
        text  = article.domain or "",
        face  = meta_face,
        fgcolor = Blitbuffer.COLOR_DARK_GRAY,
        max_width = body_w,
    }
    local time_age_widget = TextWidget:new{
        text  = time_age_text(article),
        face  = meta_face,
        fgcolor = Blitbuffer.COLOR_DARK_GRAY,
        max_width = body_w,
    }

    local body = VerticalGroup:new{
        align = "left",
        title_widget,
        VerticalSpan:new{ width = Size.padding.small },
        domain_widget,
        VerticalSpan:new{ width = Size.padding.tiny },
        time_age_widget,
    }

    -- Pad body vertically to centre it within the row.
    local body_h   = body:getSize().h
    local body_pad = math.max(0, math.floor((self.dimen.h - body_h) / 2))
    local body_box = VerticalGroup:new{
        align = "left",
        VerticalSpan:new{ width = body_pad },
        body,
    }

    -- Optional right column: percentage + status, right-aligned.
    local right_box
    if right_col_visible then
        local right_children = {}
        if progress.percent and progress.percent > 0 then
            right_children[#right_children + 1] = TextWidget:new{
                text = string.format("%d%%", math.floor(progress.percent * 100 + 0.5)),
                face = Font:getFace("cfont", 18),
                fgcolor = fg_dim,
            }
        end
        local label = status_label(progress)
        if label ~= "" then
            if #right_children > 0 then
                right_children[#right_children + 1] = VerticalSpan:new{ width = Size.padding.tiny }
            end
            right_children[#right_children + 1] = TextWidget:new{
                text = label,
                face = meta_face,
                fgcolor = Blitbuffer.COLOR_DARK_GRAY,
            }
        end
        local right_inner = VerticalGroup:new{
            align = "right",
            table.unpack(right_children),
        }
        local right_h = right_inner:getSize().h
        local right_pad = math.max(0, math.floor((self.dimen.h - right_h) / 2))
        right_box = VerticalGroup:new{
            align = "right",
            VerticalSpan:new{ width = right_pad },
            right_inner,
        }
    end

    -- Centre thumbnail vertically against body.
    local thumb_h = thumb:getSize().h
    local thumb_pad = math.max(0, math.floor((self.dimen.h - thumb_h) / 2))
    local thumb_box = VerticalGroup:new{
        align = "left",
        VerticalSpan:new{ width = thumb_pad },
        thumb,
    }

    local content_children = {
        HorizontalSpan:new{ width = h_pad },
        thumb_box,
        HorizontalSpan:new{ width = gap },
        body_box,
    }
    if right_col_visible then
        content_children[#content_children + 1] = HorizontalSpan:new{ width = gap }
        content_children[#content_children + 1] = right_box
    end
    content_children[#content_children + 1] = HorizontalSpan:new{ width = h_pad }

    local content = HorizontalGroup:new{
        align = "top",
        table.unpack(content_children),
    }

    local row = VerticalGroup:new{
        align = "left",
        content,
        VerticalSpan:new{ width = math.max(0, self.dimen.h - content:getSize().h - 1) },
        LineWidget:new{
            dimen = Geom:new{ w = self.dimen.w, h = 1 },
            background = Blitbuffer.COLOR_LIGHT_GRAY,
        },
    }

    self[1] = FrameContainer:new{
        bordersize = 0,
        padding = 0,
        margin  = 0,
        dimen = self.dimen:copy(),
        row,
    }

    self.ges_events = {
        Tap = {
            GestureRange:new{
                ges = "tap",
                range = function() return self.dimen end,
            },
        },
        Hold = {
            GestureRange:new{
                ges = "hold",
                range = function() return self.dimen end,
            },
        },
    }
end

function ArticleCard:onTap()
    if self.menu and self.menu.onMenuSelect then
        self.menu:onMenuSelect(self.entry)
    end
    return true
end

function ArticleCard:onHold()
    if self.menu and self.menu.onMenuHold then
        self.menu:onMenuHold(self.entry)
    end
    return true
end

ArticleCard.THUMB_W = THUMB_W
ArticleCard.THUMB_H = THUMB_H

return ArticleCard
