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
local OverlapGroup = require("ui/widget/overlapgroup")
local RightContainer = require("ui/widget/container/rightcontainer")
local Screen = require("device").screen
local Size = require("ui/size")
local TextWidget = require("ui/widget/textwidget")
local VerticalGroup = require("ui/widget/verticalgroup")
local VerticalSpan = require("ui/widget/verticalspan")
local lfs = require("libs/libkoreader-lfs")
local logger = require("logger")
local _ = require("gettext")

-- Compact thumbnail: 96 x 64. The previous 120 x 80 stretched each
-- row to ~210px and capped the queue at 4–5 articles per page on a
-- Libra 2; this size keeps the preview legible while fitting roughly
-- 7 rows per page.
local THUMB_W = Screen:scaleBySize(96)
local THUMB_H = Screen:scaleBySize(64)
-- Slim progress bar painted along the bottom of the thumbnail when an
-- article has reading progress. Sized so it's legible at a glance on
-- eink without overpowering the preview.
local PROGRESS_BAR_H = Screen:scaleBySize(5)

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

--- Build a slim progress bar sized to the thumbnail width. The bar is
--- two LineWidgets stacked in an OverlapGroup — a light-gray track and
--- a black fill whose width is proportional to `percent` (0..1).
--- Returns nil for zero/missing progress so callers can skip the
--- overlay entirely.
local function build_progress_bar(percent)
    if not percent or percent <= 0 then return nil end
    local pct = math.max(0, math.min(1, percent))
    local fill_w = math.max(1, math.floor(THUMB_W * pct))
    local track = LineWidget:new{
        background = Blitbuffer.COLOR_LIGHT_GRAY,
        dimen = Geom:new{ w = THUMB_W, h = PROGRESS_BAR_H },
    }
    local fill = LineWidget:new{
        background = Blitbuffer.COLOR_BLACK,
        dimen = Geom:new{ w = fill_w, h = PROGRESS_BAR_H },
    }
    return OverlapGroup:new{
        dimen = Geom:new{ w = THUMB_W, h = PROGRESS_BAR_H },
        allow_mirroring = false,
        track,
        fill,
    }
end

function ArticleCard:_buildThumbnail(progress)
    local article = (self.entry and self.entry.article) or {}

    local thumb_frame
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
            thumb_frame = FrameContainer:new{
                bordersize = Size.border.thin,
                padding = 0,
                margin = 0,
                background = Blitbuffer.COLOR_WHITE,
                dim = self.entry and self.entry.dim,
                CenterContainer:new{
                    dimen = Geom:new{ w = THUMB_W, h = THUMB_H },
                    widget,
                },
            }
        else
            logger.dbg("pilcrow: failed to render", article.image_path, widget)
        end
    end

    if not thumb_frame then
        -- Empty light-grey well for articles without (or with un-decodable)
        -- preview. The previous design used a `📄` glyph, but Noto Sans —
        -- KOReader's bundled UI font — doesn't carry that codepoint, so it
        -- fell back to the "missing glyph" box (the "?" the user saw).
        -- A bare filled rectangle reads as "no preview" without any glyph
        -- that may or may not render.
        thumb_frame = FrameContainer:new{
            bordersize = Size.border.thin,
            padding = 0,
            margin = 0,
            background = Blitbuffer.COLOR_LIGHT_GRAY,
            dim = self.entry and self.entry.dim,
            CenterContainer:new{
                dimen = Geom:new{ w = THUMB_W, h = THUMB_H },
                HorizontalSpan:new{ width = 0 },
            },
        }
    end

    local bar = progress and build_progress_bar(progress.percent)
    if not bar then return thumb_frame end

    -- Pin the bar to the bottom of the thumbnail frame. Measuring the
    -- frame's full size keeps the bar aligned whether the thumb is the
    -- image or the empty-preview well.
    local frame_h = thumb_frame:getSize().h
    bar.overlap_offset = { 0, frame_h - PROGRESS_BAR_H }
    return OverlapGroup:new{
        dimen = Geom:new{ w = thumb_frame:getSize().w, h = frame_h },
        allow_mirroring = false,
        thumb_frame,
        bar,
    }
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
    -- os.time read the fields as device-local time, but the server sends
    -- an explicit zone ("Z" or "+02:00"). Shift by (device offset − source
    -- offset) so ages don't drift by the timezone gap.
    local tail = created_at:sub(20)
    local sign, oh, om = tail:match("([+-])(%d%d):?(%d%d)")
    local src_offset = 0
    if sign then
        src_offset = (tonumber(oh) * 3600 + tonumber(om) * 60) * (sign == "-" and -1 or 1)
    elseif not tail:match("^Z") then
        -- No zone info: keep the historical local-time interpretation.
        src_offset = nil
    end
    if src_offset then
        local now = os.time()
        local local_offset = os.difftime(now, os.time(os.date("!*t", now)))
        ts = ts + local_offset - src_offset
    end
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

--- Single-line metadata: "<domain> · <reading time> · <age>".
-- Used by the compact card layout to keep the body to two rows
-- (title + meta) instead of three.
local function meta_line_text(article)
    local parts = {}
    if article.domain and article.domain ~= "" then
        parts[#parts + 1] = article.domain
    end
    local time_age = time_age_text(article)
    if time_age ~= "" then parts[#parts + 1] = time_age end
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

    -- Reading progress lives ON the thumbnail (slim bar along its
    -- bottom edge) rather than as a separate column or inline text,
    -- so read it before the thumbnail build can overlay the bar.
    local progress = read_progress(article)
    local thumb = self:_buildThumbnail(progress)

    local body_w = self.dimen.w
        - h_pad * 2
        - thumb:getSize().w
        - gap

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

    -- Terminal states ("done" / "skipped") are rare and the progress
    -- bar alone can't distinguish them — append them to the meta line
    -- so they're still callable out at a glance.
    local meta_text = meta_line_text(article)
    local terminal_label = status_label(progress)
    if terminal_label ~= "" then
        meta_text = meta_text ~= ""
            and (meta_text .. " · " .. terminal_label)
            or  terminal_label
    end

    local meta_widget = TextWidget:new{
        text  = meta_text,
        face  = meta_face,
        fgcolor = Blitbuffer.COLOR_DARK_GRAY,
        max_width = body_w,
        truncate_with_ellipsis = true,
    }

    local body = VerticalGroup:new{
        align = "left",
        title_widget,
        VerticalSpan:new{ width = Size.padding.small },
        meta_widget,
    }

    -- Pad body vertically to centre it within the row.
    local body_h   = body:getSize().h
    local body_pad = math.max(0, math.floor((self.dimen.h - body_h) / 2))
    local body_box = VerticalGroup:new{
        align = "left",
        VerticalSpan:new{ width = body_pad },
        body,
    }

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
        HorizontalSpan:new{ width = h_pad },
    }
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
