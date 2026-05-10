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
    self.height = self.height or Screen:scaleBySize(36)
    local box_size = self.height
    local glyph = TextWidget:new{
        text = "↻",
        face = Font:getFace("smallinfofont", 22),
        fgcolor = Blitbuffer.COLOR_BLACK,
    }
    local frame = FrameContainer:new{
        bordersize = Size.border.thin,
        radius = Size.radius.button,
        padding = 0,
        margin = 0,
        background = Blitbuffer.COLOR_WHITE,
        dimen = Geom:new{ w = box_size, h = box_size },
        -- Centre the glyph by padding equally on each side.
        HorizontalGroup:new{
            HorizontalSpan:new{ width = math.max(0, math.floor((box_size - glyph:getSize().w) / 2)) },
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

    -- Hairline below the bar matches the chip-row / header style.
    self[1] = VerticalGroup:new{
        align = "left",
        row,
        LineWidget:new{
            dimen = Geom:new{ w = self.width, h = 1 },
            background = Blitbuffer.COLOR_LIGHT_GRAY,
        },
    }
    self.dimen = self[1]:getSize()
end

return StatusBar
