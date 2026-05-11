--[[--
Status bar shown below the title bar in the Wallabag queue view.

Two parts:

  * left   — informational text (counts + last sync, e.g.
             "Unread: 24 · starred: 3 · synced just now")
  * right  — a tappable square button with an ↻ glyph that triggers the
             sync callback supplied by `main.lua`. ~44×44 hit target.

Implemented as a single `InputContainer` so the parent (queue view) can
inject it into Menu's `content_group` between the title bar and the
chip row.

@module pilcrow.statusbar
--]]

local Blitbuffer = require("ffi/blitbuffer")
local Font = require("ui/font")
local FrameContainer = require("ui/widget/container/framecontainer")
local Geom = require("ui/geometry")
local GestureRange = require("ui/gesturerange")
local HorizontalGroup = require("ui/widget/horizontalgroup")
local HorizontalSpan = require("ui/widget/horizontalspan")
local InputContainer = require("ui/widget/container/inputcontainer")
local LineWidget = require("ui/widget/linewidget")
local Screen = require("device").screen
local Size = require("ui/size")
local TextWidget = require("ui/widget/textwidget")
local VerticalGroup = require("ui/widget/verticalgroup")
local VerticalSpan = require("ui/widget/verticalspan")

local SyncButton = InputContainer:extend{
    callback = nil,
    height = nil,
}

function SyncButton:init()
    -- Borderless glyph at body weight. Hit area is widened slightly
    -- past the glyph for touch comfort (~28px square is plenty for an
    -- inline icon next to text — Kobo's 44px minimum applies to
    -- isolated buttons, not a target sitting in a tappable bar).
    local glyph = TextWidget:new{
        text = "↻",
        face = Font:getFace("smallinfofont", 22),
        fgcolor = Blitbuffer.COLOR_DARK_GRAY,
    }
    local glyph_w = glyph:getSize().w
    local glyph_h = glyph:getSize().h
    local hit_w = math.max(Screen:scaleBySize(28), glyph_w + Screen:scaleBySize(8))
    local hit_h = math.max(Screen:scaleBySize(28), glyph_h + Screen:scaleBySize(4))
    self.height = hit_h
    local frame = FrameContainer:new{
        bordersize = 0,
        padding = 0,
        margin = 0,
        background = Blitbuffer.COLOR_WHITE,
        dimen = Geom:new{ w = hit_w, h = hit_h },
        HorizontalGroup:new{
            HorizontalSpan:new{ width = math.max(0, math.floor((hit_w - glyph_w) / 2)) },
            glyph,
        },
    }
    self[1] = frame
    self.dimen = frame:getSize()
    self.ges_events = {
        Tap = {
            GestureRange:new{
                ges = "tap",
                range = function() return self.dimen end,
            },
        },
    }
end

function SyncButton:onTap()
    if self.callback then self.callback() end
    return true
end

------------------------------------------------------------------------
-- StatusBar
------------------------------------------------------------------------

local StatusBar = InputContainer:extend{
    text = "",
    on_sync = nil,
    width = nil,
}

function StatusBar:init()
    self.width = self.width or Screen:getWidth()

    local h_pad = Size.padding.default
    local v_pad = Size.padding.tiny

    local button = SyncButton:new{ callback = self.on_sync }
    local btn_w = button:getSize().w
    local btn_h = button:getSize().h

    local text_widget = TextWidget:new{
        text = self.text or "",
        face = Font:getFace("smallinfofont"),
        fgcolor = Blitbuffer.COLOR_DARK_GRAY,
        max_width = self.width - btn_w - h_pad * 3,
    }

    local row_h = math.max(btn_h, text_widget:getSize().h) + v_pad * 2

    -- Vertical centring helper for the text (wraps it in a VerticalGroup
    -- with a top spacer of (row_h - text_h)/2).
    local text_pad = math.max(0, math.floor((row_h - text_widget:getSize().h) / 2))
    local text_centred = VerticalGroup:new{
        align = "left",
        VerticalSpan:new{ width = text_pad },
        text_widget,
    }

    local btn_pad = math.max(0, math.floor((row_h - btn_h) / 2))
    local button_centred = VerticalGroup:new{
        align = "left",
        VerticalSpan:new{ width = btn_pad },
        button,
    }

    -- Reserve text space so the button hugs the right edge.
    local text_w = self.width - btn_w - h_pad * 3
    local row = HorizontalGroup:new{
        align = "top",
        HorizontalSpan:new{ width = h_pad },
        FrameContainer:new{
            bordersize = 0, padding = 0, margin = 0,
            dimen = Geom:new{ w = text_w, h = row_h },
            text_centred,
        },
        HorizontalSpan:new{ width = h_pad },
        button_centred,
        HorizontalSpan:new{ width = h_pad },
    }

    -- No hairline below the bar — the chip row sits directly underneath
    -- and Menu's title bar already draws its own separator below that,
    -- so a second line here makes the header look fragmented.
    self[1] = VerticalGroup:new{
        align = "left",
        row,
    }
    self.dimen = self[1]:getSize()
end

return StatusBar
