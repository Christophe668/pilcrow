--[[--
Pilcrow annotation sync.

Two-direction bridge between KOReader's per-EPUB sidecar highlights and
the configured read-it-later server (Wallabag or Readeck):

  * **Push.** After each Pilcrow sync, every highlight in a Pilcrow
    article's sidecar (`.sdr/metadata.epub.lua`) that hasn't been sent
    is POSTed to the server.

      - **Wallabag** has a `quote` field on the annotation contract, so
        the mapping is clean: KOReader's `text` → `quote`, KOReader's
        `note` → `text`, and `pos0` / `pos1` → `ranges[0]`.
      - **Readeck** has no `quote` field — only XPath selectors and a
        server-computed `text`. The KOReader XPaths don't resolve in
        Readeck's server-HTML tree, so we send them as-is and fold the
        quoted text + note into Readeck's `note` field. The annotation
        exists with full content; only the visual anchor is lossy.

  * **Pull.** During the same sync, annotations are fetched from the
    server for every cached article and stashed under
    `article.server_annotations`. The Highlights view in the plugin
    reads from there. We don't render them on the article body — the
    user has KOReader's own highlight UI for that — but they're listed
    so the user can review what they've highlighted across devices.

Per-article tracking:

  * `pushed_annotations` — table keyed by KOReader `datetime` (or a
    `pos0|text` fallback). Prevents duplicate pushes across syncs.
  * `server_annotations` — list of normalized annotations as last seen
    from the server. Refreshed each sync; the Highlights view reads it
    via `cache:get(id).server_annotations`.

@module pilcrow.annotationsync
--]]

local DocSettings = require("docsettings")
local lfs = require("libs/libkoreader-lfs")
local logger = require("logger")

local M = {}

------------------------------------------------------------------------
-- Sidecar reading
------------------------------------------------------------------------

-- Returns a flat list of annotation entries shaped as:
--   { datetime, text, note, pos0, pos1 }
-- across both the modern `annotations` array and the older
-- per-page `highlight` table. Bookmarks without a quote are ignored.
local function read_sidecar_annotations(local_path)
    if not local_path or local_path == "" then return {} end
    if lfs.attributes(local_path, "mode") ~= "file" then return {} end
    if not DocSettings:hasSidecarFile(local_path) then return {} end

    local doc_settings = DocSettings:open(local_path)
    if not doc_settings then return {} end

    local out = {}

    local annotations = doc_settings:readSetting("annotations")
    if type(annotations) == "table" then
        for _, a in ipairs(annotations) do
            if a and a.text and a.text ~= "" then
                out[#out + 1] = {
                    datetime = a.datetime,
                    text     = a.text,
                    note     = a.note,
                    pos0     = a.pos0,
                    pos1     = a.pos1,
                }
            end
        end
    end

    local highlight = doc_settings:readSetting("highlight")
    if type(highlight) == "table" then
        for _, page_list in pairs(highlight) do
            if type(page_list) == "table" then
                for _, h in ipairs(page_list) do
                    if h and h.text and h.text ~= "" then
                        out[#out + 1] = {
                            datetime = h.datetime,
                            text     = h.text,
                            note     = h.note,
                            pos0     = h.pos0,
                            pos1     = h.pos1,
                        }
                    end
                end
            end
        end
    end

    return out
end

------------------------------------------------------------------------
-- Payload shaping
------------------------------------------------------------------------

-- KOReader's `pos0` / `pos1` strings can look like
--   "/body/DocFragment[2]/body/p[7]/text()[1].42"
-- where the trailing `.<n>` is a character offset within the text node.
-- Split the path from the offset.
local function split_xpath(s)
    if not s or s == "" then return "", 0 end
    local path, offset = s:match("^(.-)%.(%d+)$")
    if path and offset then return path, tonumber(offset) or 0 end
    return s, 0
end

local function trim(s)
    return ((s or ""):gsub("^%s+", ""):gsub("%s+$", ""))
end

local function readeck_note_body(quote, user_note)
    local q = trim(quote)
    local n = trim(user_note)
    if q == "" then return n end
    local header = "« " .. q .. " »"
    if n == "" then return header end
    return header .. "\n\n" .. n
end

local function entry_key(entry)
    if entry.datetime and entry.datetime ~= "" then return entry.datetime end
    return (entry.pos0 or "") .. "|" .. (entry.text or "")
end

function M._toReadeckPayload(entry)
    local start_sel, start_off = split_xpath(entry.pos0)
    local end_sel, end_off = split_xpath(entry.pos1)
    if end_sel == "" then end_sel = start_sel end
    return {
        start_selector = start_sel,
        start_offset   = start_off,
        end_selector   = end_sel,
        end_offset     = end_off,
        note           = readeck_note_body(entry.text, entry.note),
    }
end

function M._toWallabagPayload(entry)
    local start_sel, start_off = split_xpath(entry.pos0)
    local end_sel, end_off = split_xpath(entry.pos1)
    if end_sel == "" then end_sel = start_sel end
    local payload = {
        quote  = trim(entry.text),
        ranges = { {
            start       = start_sel,
            startOffset = start_off,
            ["end"]     = end_sel,
            endOffset   = end_off,
        } },
    }
    local note = trim(entry.note)
    if note ~= "" then payload.text = note end
    return payload
end

------------------------------------------------------------------------
-- Normalization for the Highlights view
------------------------------------------------------------------------

-- Reduce a server annotation (either flavour) into the shape the UI
-- consumes. The fields are deliberately broad — different servers
-- expose different metadata, and the Highlights view shows whatever
-- ends up populated.
local function normalize_readeck(a)
    return {
        id      = tostring(a.id or ""),
        quote   = a.text or "",
        note    = a.note or "",
        created = a.created or a.created_at or "",
    }
end

local function normalize_wallabag(a)
    return {
        id      = tostring(a.id or ""),
        quote   = a.quote or "",
        note    = a.text or "",
        created = a.created_at or "",
    }
end

------------------------------------------------------------------------
-- Push pass
------------------------------------------------------------------------

-- Push KOReader sidecar highlights to whichever backend is configured.
-- Returns `{ pushed, skipped, failed }`. Individual failures don't abort
-- the sweep.
function M.pushAll(cache, client, on_step)
    local counters = { pushed = 0, skipped = 0, failed = 0 }
    if not client or type(client.createAnnotation) ~= "function" then
        return counters
    end

    local to_payload
    if client.kind == "readeck" then
        to_payload = M._toReadeckPayload
    elseif client.kind == "wallabag" then
        to_payload = M._toWallabagPayload
    else
        return counters
    end

    local ids = cache:listIds()
    for _, id in ipairs(ids) do
        local article = cache:get(id)
        if article and article.local_path and article.local_path ~= "" then
            local pushed_map = article.pushed_annotations or {}
            local sidecar = read_sidecar_annotations(article.local_path)
            for _, entry in ipairs(sidecar) do
                local key = entry_key(entry)
                if pushed_map[key] then
                    counters.skipped = counters.skipped + 1
                else
                    local payload = to_payload(entry)
                    local ok, err = client:createAnnotation(id, payload)
                    if ok then
                        pushed_map[key] = true
                        counters.pushed = counters.pushed + 1
                    else
                        counters.failed = counters.failed + 1
                        logger.warn("pilcrow/annotationsync: push failed for", id, err)
                    end
                    if on_step then on_step(counters.pushed, counters.failed) end
                end
            end
            cache:setFlag(id, "pushed_annotations", pushed_map)
        end
    end

    return counters
end

------------------------------------------------------------------------
-- Pull pass
------------------------------------------------------------------------

-- Fetch annotations for every cached article and stash them on the
-- cache entry under `server_annotations`. Errors per article are
-- logged and the sweep continues; existing data on the entry is
-- preserved when a fetch fails so a transient hiccup doesn't blank
-- the Highlights view.
--
-- Returns `{ fetched, articles, failed }` where `fetched` is the total
-- annotation count across all articles, `articles` is the number of
-- articles successfully queried, and `failed` is the number of articles
-- whose fetch errored.
function M.pullAll(cache, client, on_step)
    local counters = { fetched = 0, articles = 0, failed = 0 }
    if not client or type(client.listAnnotations) ~= "function" then
        return counters
    end

    local normalize
    if client.kind == "readeck" then
        normalize = normalize_readeck
    elseif client.kind == "wallabag" then
        normalize = normalize_wallabag
    else
        return counters
    end

    local ids = cache:listIds()
    for _, id in ipairs(ids) do
        local article = cache:get(id)
        if article then
            local ok, list_or_err = client:listAnnotations(id)
            if not ok then
                counters.failed = counters.failed + 1
                logger.warn("pilcrow/annotationsync: pull failed for", id, list_or_err)
            else
                local normalized = {}
                if type(list_or_err) == "table" then
                    for _, raw in ipairs(list_or_err) do
                        normalized[#normalized + 1] = normalize(raw)
                    end
                end
                cache:setFlag(id, "server_annotations", normalized)
                counters.articles = counters.articles + 1
                counters.fetched = counters.fetched + #normalized
                if on_step then on_step(counters.articles, counters.fetched) end
            end
        end
    end

    return counters
end

------------------------------------------------------------------------
-- Flat list for the Highlights view
------------------------------------------------------------------------

-- Walk the cache and return every server annotation flattened with its
-- article context. Useful for the Highlights view, which renders one
-- screen of "quote — article title" rows regardless of which article
-- the annotation belongs to.
function M.listAllForUI(cache)
    local out = {}
    for _, id in ipairs(cache:listIds()) do
        local article = cache:get(id)
        if article and type(article.server_annotations) == "table" then
            for _, a in ipairs(article.server_annotations) do
                out[#out + 1] = {
                    id           = a.id,
                    quote        = a.quote,
                    note         = a.note,
                    created      = a.created,
                    article_id   = id,
                    article_title = article.title or "",
                    article_url  = article.url or "",
                }
            end
        end
    end
    return out
end

return M
