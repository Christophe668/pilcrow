--[[--
Pilcrow queue view.

Subclass of `Menu` that:

  * shows the cached article list, filtered by status / tags / search /
    sort and rendered via `articlerow.format`
  * injects a ChipRow between the title bar and the items when any
    filter is active (so items_layout shrinks accordingly)
  * exposes top-bar dialogs for tags (multi-select), sort, and search
  * persists the filter state via the injected `settings` object so the
    next launch lands on the same filter / sort

The queue is a presenter — it never speaks to Wallabag. Mutations happen
through callbacks (`on_open_article`, `on_action`, `on_sync`,
`on_open_settings`) supplied by `main.lua`.

@module pilcrow.queueview
--]]

local ButtonDialog = require("ui/widget/buttondialog")
local ConfirmBox = require("ui/widget/confirmbox")
local InputDialog = require("ui/widget/inputdialog")
local Menu = require("ui/widget/menu")
local Screen = require("device").screen
local UIManager = require("ui/uimanager")
local _ = require("gettext")
local T = require("ffi/util").template

local ArticleCard = require("articlecard")
local ArticleRow = require("articlerow")
local ChipRowMod = require("chiprow")
local ChipRow = ChipRowMod.ChipRow
local StatusBar = require("statusbar")

local DEFAULT_SORT   = "newest"
local DEFAULT_STATUS = "unread"

local SORT_LABELS = {
    newest   = _("Newest first"),
    oldest   = _("Oldest first"),
    longest  = _("Longest first"),
    shortest = _("Shortest first"),
    domain   = _("Domain (A → Z)"),
}

local STATUS_LABELS = {
    unread      = _("Unread"),
    in_progress = _("In progress"),
    starred     = _("Starred"),
    archived    = _("Archived"),
    all         = _("All"),
}

local STATUS_ORDER = { "unread", "in_progress", "starred", "archived", "all" }

local APP_TITLE = _("Pilcrow")
-- Backend-specific labels are kept for actions that name a remote
-- service ("Delete from Readeck", "Refetch from Wallabag") — the
-- queue's own chrome carries the plugin brand instead.
local BACKEND_TITLES = {
    wallabag = _("Wallabag"),
    readeck  = _("Readeck"),
}

local QueueView = Menu:extend{
    is_borderless        = true,
    covers_fullscreen    = true,
    title                = APP_TITLE,
    title_bar_left_icon  = "appbar.menu",
    title_bar_fm_style   = true,
    -- Setting `subtitle = false` (not nil) blocks Menu.lua's
    -- auto-promotion of the subtitle slot to "" when fm_style is on.
    -- Otherwise an invisible-but-present empty subtitle widget eats a
    -- text-line of vertical space below "Pilcrow", pushing the status
    -- bar far away from the title.
    subtitle             = false,
    -- 7 fits the new compact (THUMB_H = 64) card on a Libra 2 with a
    -- chip row + status bar visible. _recalculateDimen re-floors the
    -- row height anyway, so this is just a "max rows per page" hint.
    items_per_page       = 7,
    -- Injected by main.lua:
    cache                = nil,
    settings             = nil,
    backend_kind         = "wallabag",
    supports_reload      = true,
    -- Optional `function(article) -> bool`. Lets the queue ask the
    -- host (main.lua) whether an article has reading progress, so it
    -- can hide the "Clear reading progress" row when there's nothing
    -- to clear. The queue itself doesn't touch DocSettings.
    has_progress_fn      = nil,
    on_open_article      = nil,
    on_action            = nil,
    on_sync              = nil,
    on_open_settings     = nil,
    on_open_koreader_menu = nil,
}

------------------------------------------------------------------------
-- Lifecycle
------------------------------------------------------------------------

function QueueView:init()
    self.width  = self.width  or Screen:getWidth()
    self.height = self.height or Screen:getHeight()
    self:_loadFilterState()

    self.title = APP_TITLE
    self.title_bar_left_icon = "appbar.menu"
    self.onLeftButtonTap     = function() self:showActionsMenu() end
    -- TitleBar's subtitle slot stays empty; counts + last-sync render
    -- inside our StatusBar below the title bar (with a tappable ↻).
    self.subtitle = ""
    self.item_table = self:_buildItemTable()
    Menu.init(self)
    self:_rebuildChrome()
end

function QueueView:_loadFilterState()
    local s = self.settings
    self.filter_state = {
        status = (s and s:get("active_status")) or DEFAULT_STATUS,
        tags   = (s and s:get("active_tags")) or {},
        search = "",  -- search is session-scoped, not persisted
        sort   = (s and s:get("sort_key")) or DEFAULT_SORT,
    }
    -- Defensive copies to avoid aliasing the persisted table
    if type(self.filter_state.tags) ~= "table" then
        self.filter_state.tags = {}
    else
        local copy = {}
        for _, t in ipairs(self.filter_state.tags) do copy[#copy + 1] = t end
        self.filter_state.tags = copy
    end
end

function QueueView:_persistFilterState()
    if not self.settings then return end
    self.settings:set("active_status", self.filter_state.status)
    self.settings:set("active_tags",   self.filter_state.tags)
    self.settings:set("sort_key",      self.filter_state.sort)
end

------------------------------------------------------------------------
-- _recalculateDimen: account for chip row height
------------------------------------------------------------------------

function QueueView:_recalculateDimen(no_recalculate_dimen)
    -- Always do the full Menu recompute. We can't honour the
    -- `no_recalculate_dimen` shortcut here because our chip-row and
    -- status-bar subtractions need a *fresh* available_height each
    -- time — otherwise rows collapse a little smaller on every page
    -- change as `available_height -= extra` accumulates against an
    -- already-reduced value.
    Menu._recalculateDimen(self, false)
    local extra = 0
    if self.status_bar then extra = extra + self.status_bar:getSize().h end
    if self.chip_row   then extra = extra + self.chip_row:getSize().h   end
    if extra > 0 then
        self.available_height = math.max(0, self.available_height - extra)
        self.item_dimen.h = math.floor(self.available_height / self.perpage)
    end
end

------------------------------------------------------------------------
-- updateItems: render ArticleCard rows instead of MenuItem
------------------------------------------------------------------------

function QueueView:updateItems(select_number, no_recalculate_dimen)
    local UIManager = require("ui/uimanager")
    local old_dimen = self.dimen and self.dimen:copy()

    self.layout = {}
    self.item_group:clear()
    self.page_info:resetLayout()
    self.return_button:resetLayout()
    self.content_group:resetLayout()
    self:_recalculateDimen(no_recalculate_dimen)

    local items_nb = self.perpage
    local idx_offset = (self.page - 1) * items_nb

    for idx = 1, items_nb do
        local index = idx_offset + idx
        local item = self.item_table[index]
        if item == nil then break end
        item.idx = index

        local widget
        if item.article then
            widget = ArticleCard:new{
                show_parent = self.show_parent,
                entry = item,
                menu  = self,
                dimen = self.item_dimen:copy(),
            }
        else
            -- Empty-state / placeholder: stretch to fill the entire body so
            -- the centred message lives in the middle of the available space
            -- instead of cramped against the chip row.
            local FrameContainer  = require("ui/widget/container/framecontainer")
            local CenterContainer = require("ui/widget/container/centercontainer")
            local TextBoxWidget   = require("ui/widget/textboxwidget")
            local Font            = require("ui/font")
            local Geom            = require("ui/geometry")
            local fill_dimen = Geom:new{
                w = self.item_dimen.w,
                h = self.available_height or self.item_dimen.h,
            }
            widget = FrameContainer:new{
                bordersize = 0, padding = 0, margin = 0,
                dimen = fill_dimen,
                CenterContainer:new{
                    dimen = fill_dimen,
                    TextBoxWidget:new{
                        text = item.text or "",
                        face = Font:getFace("smallinfofont"),
                        width = math.floor(fill_dimen.w * 0.8),
                        alignment = "center",
                    },
                },
            }
            -- Only a single placeholder row; stop iterating so we don't
            -- fill out other empty rows below it.
            table.insert(self.item_group, widget)
            table.insert(self.layout, { widget })
            break
        end

        table.insert(self.item_group, widget)
        table.insert(self.layout, { widget })
    end

    self:updatePageInfo(select_number)
    self:mergeTitleBarIntoLayout()

    UIManager:setDirty(self.show_parent, function()
        local refresh_dimen =
            old_dimen and old_dimen:combine(self.dimen)
            or self.dimen
        return "ui", refresh_dimen
    end)
end

------------------------------------------------------------------------
-- Item table
------------------------------------------------------------------------

local EMPTY_ITEM = function(text)
    return { text = text, mandatory = "", dim = true, callback = function() end }
end

function QueueView:_buildItemTable()
    if not self.cache then
        return { EMPTY_ITEM(_("Cache unavailable.")) }
    end
    local articles = self.cache:list({
        status = self.filter_state.status,
        tags   = self.filter_state.tags,
        search = self.filter_state.search,
        sort   = self.filter_state.sort,
    })
    self.last_result_count = #articles
    if #articles == 0 then
        local hint
        if self.cache:lastSynced() == 0 then
            hint = _("No articles yet. Tap the menu icon and choose Sync.")
        elseif self:_anyFilterActive() then
            hint = _("No articles match these filters. Tap a chip to clear it.")
        else
            hint = _("No articles match this filter.")
        end
        return { EMPTY_ITEM(hint) }
    end
    local items = {}
    for _, article in ipairs(articles) do
        items[#items + 1] = ArticleRow.format(article)
    end
    return items
end

function QueueView:_anyFilterActive()
    local fs = self.filter_state
    return fs.status ~= DEFAULT_STATUS
        or (fs.tags and #fs.tags > 0)
        or (fs.search and fs.search ~= "")
        or fs.sort ~= DEFAULT_SORT
end

--- Singular word for the visible count, picked from the active filter.
--- Keeps the status bar legible at 540px width — the old breakdown
--- ("Total: 237 · unread: 237 · starred: 0") wrapped on narrow screens
--- and duplicated information the chip row already shows.
local STATUS_WORDS = {
    unread      = function(n) return T(_("%1 unread"), n) end,
    in_progress = function(n) return T(_("%1 in progress"), n) end,
    starred     = function(n) return T(_("%1 starred"), n) end,
    archived    = function(n) return T(_("%1 archived"), n) end,
    all         = function(n) return T(_("%1 articles"), n) end,
}

function QueueView:_buildSubtitle()
    if not self.cache then return "" end
    local last = self.cache:lastSynced()
    local sync_text
    if last == 0 then
        sync_text = _("never synced")
    else
        local delta = os.time() - last
        if     delta < 60      then sync_text = _("synced just now")
        elseif delta < 3600    then sync_text = T(_("synced %1 min ago"), math.floor(delta/60))
        elseif delta < 86400   then sync_text = T(_("synced %1 h ago"), math.floor(delta/3600))
        elseif delta < 86400*2 then sync_text = _("synced yesterday")
        elseif delta < 86400*7 then sync_text = T(_("synced %1 days ago"), math.floor(delta/86400))
        else                       sync_text = T(_("synced %1"), os.date("%Y-%m-%d", last))
        end
    end

    local count = self.last_result_count or 0
    local fs = self.filter_state
    local has_secondary_filter = (fs.tags and #fs.tags > 0)
        or (fs.search and fs.search ~= "")
    local count_text
    if has_secondary_filter then
        count_text = T(_("%1 results"), count)
    else
        local fmt = STATUS_WORDS[fs.status] or STATUS_WORDS.all
        count_text = fmt(count)
    end
    return count_text .. " · " .. sync_text
end

------------------------------------------------------------------------
-- Reload + chip-row sync
------------------------------------------------------------------------

function QueueView:reload()
    -- StatusBar carries the live count/sync text — we never touch the
    -- TitleBar's subtitle slot. Passing nil as the 5th arg leaves it
    -- alone (passing "" would re-create the empty subtitle widget and
    -- bring the spacing problem back).
    self:switchItemTable(APP_TITLE, self:_buildItemTable(), 1, nil, nil)
    self:_rebuildChrome()
    UIManager:setDirty(self, "ui")
end

local function index_in(group, target)
    for i, w in ipairs(group) do
        if w == target then return i end
    end
end

local function remove_widget(group, widget)
    if not widget or not group then return end
    local idx = index_in(group, widget)
    if idx then table.remove(group, idx) end
end

--- Build (or rebuild) the status bar and chip row in-place. Order in
-- content_group is fixed: [header, status_bar, (chip_row), body].
function QueueView:_rebuildChrome()
    if not self.content_group then return end

    remove_widget(self.content_group, self.status_bar)
    remove_widget(self.content_group, self.chip_row)
    self.status_bar, self.chip_row = nil, nil

    self.status_bar = StatusBar:new{
        text  = self:_buildSubtitle(),
        width = self.inner_dimen.w,
        on_sync = function()
            if self.on_sync then
                self.on_sync(function() self:reload() end)
            end
        end,
    }
    table.insert(self.content_group, 2, self.status_bar)

    local chips = self:_chipsForState()
    if #chips > 0 then
        self.chip_row = ChipRow:new{
            chips = chips,
            max_width = self.inner_dimen.w,
        }
        table.insert(self.content_group, 3, self.chip_row)
    end

    self:_recalculateDimen()
    self:updateItems(1, true)
end

-- Compatibility shims for the old call sites.
QueueView._rebuildStatusBar = QueueView._rebuildChrome
QueueView._rebuildChipRow   = QueueView._rebuildChrome

-- Threshold above which individual ✕-tag chips are suppressed in
-- favour of the summary picker chip alone. With many tags selected
-- the per-tag chips push everything else off-screen and the picker
-- dialog is the better place to manage them anyway.
local TAG_CHIP_COLLAPSE_THRESHOLD = 3

function QueueView:_chipsForState()
    local fs = self.filter_state
    local chips = {}

    -- Picker chips first — always present, grouped together at the
    -- start of the row. Outline style with a ▾ caret signals
    -- "tap to choose". Removable chips (✕) come after.
    chips[#chips + 1] = {
        text = (STATUS_LABELS[fs.status] or fs.status) .. "  ▾",
        callback = function() self:showStatusDialog() end,
    }

    local tag_count = (fs.tags and #fs.tags) or 0
    local tag_chip_text
    if tag_count == 0 then
        tag_chip_text = _("Tags") .. "  ▾"
    else
        tag_chip_text = T(_("Tags: %1"), tag_count) .. "  ▾"
    end
    chips[#chips + 1] = {
        text = tag_chip_text,
        callback = function() self:showTagsDialog() end,
    }

    -- Sort picker (always shown — handled below right after Tags so
    -- all three pickers cluster together regardless of how many
    -- removable filters are active).
    local at_default_sort = fs.sort == DEFAULT_SORT
    local sort_text = SORT_LABELS[fs.sort] or fs.sort
    chips[#chips + 1] = {
        text = sort_text .. (at_default_sort and "  ▾" or "  ✕"),
        callback = function()
            if at_default_sort then
                self:showSortDialog()
            else
                self.filter_state.sort = DEFAULT_SORT
                self:_persistFilterState()
                self:reload()
            end
        end,
        hold_callback = function() self:showSortDialog() end,
    }

    -- Individual tag chips — tap to remove. Suppressed above the
    -- threshold; the summary chip + dialog handle bulk management.
    if tag_count > 0 and tag_count <= TAG_CHIP_COLLAPSE_THRESHOLD then
        for _, tag in ipairs(fs.tags) do
            local captured = tag
            chips[#chips + 1] = {
                text = "#" .. tag .. "  ✕",
                callback = function() self:removeTag(captured); self:reload() end,
            }
        end
    end

    -- Search chip — removable, comes last.
    if fs.search and fs.search ~= "" then
        chips[#chips + 1] = {
            text = "⌕ \"" .. fs.search .. "\"  ✕",
            callback = function() self.filter_state.search = ""; self:reload() end,
        }
    end

    return chips
end


------------------------------------------------------------------------
-- Tap / hold on items
------------------------------------------------------------------------

function QueueView:onMenuChoice(item)
    if not item.article_id or not self.cache then return end
    local article = self.cache:get(item.article_id)
    if not article then return end
    if self.on_open_article then self.on_open_article(article) end
end

function QueueView:onMenuHold(item)
    if not item.article_id or not self.cache then return end
    local article = self.cache:get(item.article_id)
    if not article then return end
    self:showRowMenu(article)
end

------------------------------------------------------------------------
-- Per-row context menu (unchanged from v1)
------------------------------------------------------------------------

function QueueView:showRowMenu(article)
    local dialog
    local function fire(action)
        UIManager:close(dialog)
        if self.on_action then
            self.on_action(action, article, function() self:reload() end)
        end
    end

    local read_label = article.is_archived and _("Mark as unread") or _("Mark as read")
    local star_label = article.is_starred  and _("Unstar")          or _("Star")

    local backend_title = BACKEND_TITLES[self.backend_kind] or _("Wallabag")
    local rows = {
        {{ text = read_label, callback = function() fire("toggle_archive") end }},
        {{ text = star_label, callback = function() fire("toggle_star")    end }},
        {{ text = _("Delete"), callback = function()
            UIManager:close(dialog)
            UIManager:show(ConfirmBox:new{
                text = T(_("Delete \"%1\" from %2?"), article.title or "", backend_title),
                ok_text = _("Delete"),
                ok_callback = function()
                    if self.on_action then
                        self.on_action("delete", article, function() self:reload() end)
                    end
                end,
            })
        end }},
        {{ text = _("Copy URL to clipboard"),
           callback = function() fire("copy_url") end }},
    }
    if self.has_progress_fn and self.has_progress_fn(article) then
        rows[#rows + 1] = {{
            text = _("Clear reading progress"),
            callback = function() fire("clear_progress") end,
        }}
    end
    if self.supports_reload then
        rows[#rows + 1] = {{
            text = T(_("↻ Refetch from %1"), backend_title),
            callback = function() fire("refetch") end,
        }}
    end
    rows[#rows + 1] = {{ text = _("Cancel"),
                         callback = function() UIManager:close(dialog) end }}

    dialog = ButtonDialog:new{
        title = article.title or _("(untitled)"),
        title_align = "center",
        buttons = rows,
    }
    UIManager:show(dialog)
end

------------------------------------------------------------------------
-- Top-bar actions menu
------------------------------------------------------------------------

function QueueView:showActionsMenu()
    local dialog
    local fs = self.filter_state
    local tag_label
    if #fs.tags == 0 then
        tag_label = _("Tags: none →")
    elseif #fs.tags == 1 then
        tag_label = T(_("Tags: 1 selected (%1) →"), fs.tags[1])
    else
        tag_label = T(_("Tags: %1 selected →"), #fs.tags)
    end
    local sort_label = T(_("Sort: %1 →"), SORT_LABELS[fs.sort] or fs.sort)

    dialog = ButtonDialog:new{
        title = APP_TITLE,
        title_align = "center",
        buttons = {
            {{ text = _("Sync now"), callback = function()
                UIManager:close(dialog)
                if self.on_sync then self.on_sync(function() self:reload() end) end
            end }},
            {{ text = tag_label, callback = function()
                UIManager:close(dialog)
                self:showTagsDialog()
            end }},
            {{ text = sort_label, callback = function()
                UIManager:close(dialog)
                self:showSortDialog()
            end }},
            {{ text = _("Search…"), callback = function()
                UIManager:close(dialog)
                self:showSearchPrompt()
            end }},
            {{ text = _("Clear filters"),
               enabled = self:_anyFilterActive(),
               callback = function()
                   UIManager:close(dialog)
                   self:clearAllFilters()
               end }},
            {{ text = _("Settings…"), callback = function()
                UIManager:close(dialog)
                if self.on_open_settings then self.on_open_settings() end
            end }},
            {{ text = _("KOReader menu…"), callback = function()
                UIManager:close(dialog)
                if self.on_open_koreader_menu then self.on_open_koreader_menu() end
            end }},
            {{ text = _("Close"), callback = function() UIManager:close(dialog) end }},
        },
    }
    UIManager:show(dialog)
end

function QueueView:clearAllFilters()
    self.filter_state.status = DEFAULT_STATUS
    self.filter_state.tags   = {}
    self.filter_state.search = ""
    self.filter_state.sort   = DEFAULT_SORT
    self:_persistFilterState()
    self:reload()
end

------------------------------------------------------------------------
-- Status dialog (mini-dialog, 5 buttons)
------------------------------------------------------------------------

function QueueView:showStatusDialog()
    local dialog
    local function pick(value)
        UIManager:close(dialog)
        self.filter_state.status = value
        self:_persistFilterState()
        self:reload()
    end
    local rows = {}
    for _, key in ipairs(STATUS_ORDER) do
        local label = STATUS_LABELS[key] or key
        local count = self.cache and self.cache:count(key) or 0
        label = string.format("%s (%d)", label, count)
        if key == self.filter_state.status then label = "▸ " .. label end
        rows[#rows + 1] = {{ text = label, callback = function() pick(key) end }}
    end
    rows[#rows + 1] = {{ text = _("Cancel"),
                         callback = function() UIManager:close(dialog) end }}
    dialog = ButtonDialog:new{
        title = _("Status"), title_align = "center", buttons = rows,
    }
    UIManager:show(dialog)
end

------------------------------------------------------------------------
-- Sort dialog
------------------------------------------------------------------------

function QueueView:showSortDialog()
    local dialog
    local function pick(value)
        UIManager:close(dialog)
        self.filter_state.sort = value
        self:_persistFilterState()
        self:reload()
    end
    local rows = {}
    for _, key in ipairs({ "newest", "oldest", "longest", "shortest", "domain" }) do
        local label = SORT_LABELS[key] or key
        if key == self.filter_state.sort then label = "▸ " .. label end
        rows[#rows + 1] = {{ text = label, callback = function() pick(key) end }}
    end
    rows[#rows + 1] = {{ text = _("Cancel"),
                         callback = function() UIManager:close(dialog) end }}
    dialog = ButtonDialog:new{
        title = _("Sort by"), title_align = "center", buttons = rows,
    }
    UIManager:show(dialog)
end

------------------------------------------------------------------------
-- Tags multi-select dialog
------------------------------------------------------------------------

local function set_contains(set, value)
    for _, v in ipairs(set) do if v == value then return true end end
    return false
end

function QueueView:removeTag(tag)
    local out = {}
    for _, t in ipairs(self.filter_state.tags) do
        if t ~= tag then out[#out + 1] = t end
    end
    self.filter_state.tags = out
    self:_persistFilterState()
end

function QueueView:showTagsDialog()
    -- Always show the full tag catalogue. Scoping by the current
    -- status hides tags that exist on (say) archived articles when
    -- the user happens to be viewing the unread filter — that's
    -- confusing, especially in a "0 results" state where the user
    -- is most likely opening this picker precisely to relax their
    -- filter. Counts still come from `tagCounts`, which we ask for
    -- across "all" so the displayed numbers represent the cache,
    -- not the current view.
    local tag_counts = self.cache:tagCounts("all")

    -- Make sure currently-selected tags are always in the dialog,
    -- even if the cache has been pruned since they were applied
    -- (e.g. their last article was deleted). Otherwise the user
    -- can't deselect them from here.
    local present = {}
    for _, entry in ipairs(tag_counts) do present[entry.tag] = true end
    for _, t in ipairs(self.filter_state.tags or {}) do
        if not present[t] then
            tag_counts[#tag_counts + 1] = { tag = t, count = 0 }
            present[t] = true
        end
    end

    if #tag_counts == 0 then
        UIManager:show(require("ui/widget/infomessage"):new{
            text = _("No tags found in cached articles."), timeout = 2,
        })
        return
    end

    -- Build a working selection set we can mutate before Apply.
    local selected = {}
    for _, t in ipairs(self.filter_state.tags) do selected[t] = true end

    local function selected_count()
        local n = 0
        for _, v in pairs(selected) do if v then n = n + 1 end end
        return n
    end

    local dialog
    local function rebuild()
        UIManager:close(dialog)

        local rows = {}
        for _, entry in ipairs(tag_counts) do
            local tag, count = entry.tag, entry.count
            local tick = selected[tag] and "☑ " or "☐ "
            local label = string.format("%s%s    (%d)", tick, tag, count)
            rows[#rows + 1] = {{
                text = label,
                callback = function()
                    selected[tag] = not selected[tag]
                    rebuild()
                end,
            }}
        end
        rows[#rows + 1] = {{
            text = _("Clear selection"),
            enabled = selected_count() > 0,
            callback = function()
                for k in pairs(selected) do selected[k] = nil end
                rebuild()
            end,
        }}
        rows[#rows + 1] = {{
            text = _("Cancel"),
            callback = function() UIManager:close(dialog) end,
        }}
        rows[#rows + 1] = {{
            text = T(_("Apply (%1)"), selected_count()),
            callback = function()
                UIManager:close(dialog)
                local out = {}
                for tag, on in pairs(selected) do
                    if on then out[#out + 1] = tag end
                end
                table.sort(out)
                self.filter_state.tags = out
                self:_persistFilterState()
                self:reload()
            end,
        }}

        dialog = ButtonDialog:new{
            title = T(_("Filter by tag · %1 selected"), selected_count()),
            title_align = "center",
            buttons = rows,
        }
        UIManager:show(dialog)
    end
    rebuild()
end

------------------------------------------------------------------------
-- Search prompt
------------------------------------------------------------------------

function QueueView:showSearchPrompt()
    local input
    input = InputDialog:new{
        title = _("Search"),
        input = self.filter_state.search or "",
        input_hint = _("title or domain"),
        buttons = {{
            { text = _("Cancel"), id = "close",
              callback = function() UIManager:close(input) end },
            { text = _("Search"), is_enter_default = true,
              callback = function()
                  self.filter_state.search = input:getInputText() or ""
                  UIManager:close(input)
                  self:reload()
              end },
        }},
    }
    UIManager:show(input)
    input:onShowKeyboard()
end

return QueueView
