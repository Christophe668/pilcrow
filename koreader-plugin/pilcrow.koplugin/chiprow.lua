--[[--
Tappable chip widgets and a wrap-aware row container.

Each `Chip` is a small bordered text label that fires a callback when
tapped. `ChipRow` arranges chips into one or more horizontal lines,
wrapping to a new line when the next chip would exceed the configured
width.

The chip row sits between the queue's title bar and item list when any
filter is active. Tapping a chip applies the filter-specific behaviour:

  * status chip → opens the 4-option mini-dialog
  * tag chip    → removes that tag from the active set
  * search chip → clears the search term
  * sort chip   → resets sort to default (newest first)

@module pilcrow.chiprow
--]]

local Blitbuffer = require("ffi/blitbuffer")
local Font = require("ui/font")
local FrameContainer = require("ui/widget/container/framecontainer")
local Geom = require("ui/geometry")
local GestureRange = require("ui/gesturerange")
local HorizontalGroup = require("ui/widget/horizontalgroup")
local HorizontalSpan = require("ui/widget/horizontalspan")
local InputContainer = require("ui/widget/container/inputcontainer")
local Screen = require("device").screen
local Size = require("ui/size")
local TextWidget = require("ui/widget/textwidget")
local VerticalGroup = require("ui/widget/verticalgroup")
local VerticalSpan = require("ui/widget/verticalspan")

local Chip = InputContainer:extend{
    text = "",
    callback = nil,
    solid = false,    -- filled style (status chip)
}

function Chip:init()
    local face = Font:getFace("xx_smallinfofont")
    local fg = self.solid and Blitbuffer.COLOR_WHITE or Blitbuffer.COLOR_BLACK
    local bg = self.solid and Blitbuffer.COLOR_BLACK or Blitbuffer.COLOR_WHITE

    local text_widget = TextWidget:new{
        text = self.text,
        face = face,
        fgcolor = fg,
    }

    local frame = FrameContainer:new{
        bordersize  = Size.border.thin,
        radius      = Size.radius.button,
        background  = bg,
        padding_left   = Size.padding.button,
        padding_right  = Size.padding.button,
        padding_top    = Size.padding.tiny,
        padding_bottom = Size.padding.tiny,
        margin = 0,
        text_widget,
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

function Chip:onTap()
    if self.callback then self.callback() end
    return true
end

------------------------------------------------------------------------
-- ChipRow: wrap-aware vertical group of horizontal chip lines
------------------------------------------------------------------------

local ChipRow = VerticalGroup:extend{
    chips = nil,         -- array of { text=…, solid=…, callback=… }
    max_width = nil,     -- wrap point in pixels
    chip_gap = nil,
    line_gap = nil,
    h_padding = nil,     -- horizontal padding around the whole row
    v_padding = nil,     -- vertical padding above & below
}

function ChipRow:init()
    self.chips     = self.chips or {}
    self.max_width = self.max_width or Screen:getWidth()
    self.chip_gap  = self.chip_gap or Size.span.horizontal_small
    self.line_gap  = self.line_gap or Size.padding.tiny
    self.h_padding = self.h_padding or Size.padding.default
    self.v_padding = self.v_padding or Size.padding.tiny

    local content_width = self.max_width - 2 * self.h_padding

    -- Materialise chip widgets
    local chip_widgets = {}
    for _, c in ipairs(self.chips) do
        chip_widgets[#chip_widgets + 1] = Chip:new{
            text = c.text,
            solid = c.solid and true or false,
            callback = c.callback,
        }
    end

    -- Greedy line-wrap
    local lines = {}
    local line  = HorizontalGroup:new{ align = "center" }
    local x = 0
    for _, chip in ipairs(chip_widgets) do
        local cw = chip:getSize().w
        if x > 0 and (x + self.chip_gap + cw) > content_width then
            lines[#lines + 1] = line
            line = HorizontalGroup:new{ align = "center" }
            x = 0
        end
        if x > 0 then
            table.insert(line, HorizontalSpan:new{ width = self.chip_gap })
            x = x + self.chip_gap
        end
        table.insert(line, chip)
        x = x + cw
    end
    if #line > 0 then lines[#lines + 1] = line end

    -- Top padding
    table.insert(self, VerticalSpan:new{ width = self.v_padding })

    -- Each line wrapped in HorizontalGroup with leading h_padding
    for i, ln in ipairs(lines) do
        if i > 1 then
            table.insert(self, VerticalSpan:new{ width = self.line_gap })
        end
        local padded = HorizontalGroup:new{
            HorizontalSpan:new{ width = self.h_padding },
            ln,
        }
        table.insert(self, padded)
    end

    -- Bottom padding
    table.insert(self, VerticalSpan:new{ width = self.v_padding })
end

return {
    Chip = Chip,
    ChipRow = ChipRow,
}
