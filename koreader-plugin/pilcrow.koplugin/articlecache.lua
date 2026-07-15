--[[--
Offline article-metadata cache for Pilcrow.

Stored as a single JSON file under the plugin's data directory. The file
is small (kilobytes per hundred articles) and is rewritten atomically.

Schema (top-level):
{
    version       = 1,
    last_synced   = <unix-ts>,
    articles      = {
        [<id>] = {
            id          = number,
            title       = string,
            url         = string,
            domain      = string,
            reading_time= number,   -- minutes (server-provided)
            created_at  = string,   -- ISO 8601 from server
            is_archived = boolean,
            is_starred  = boolean,
            tags        = { <string>, ... },
            local_path  = string|nil,  -- set after download
            finished    = boolean,     -- marked read on this device; the
                                       -- archive push happens on sync
        },
        ...
    },
}

The cache is intentionally write-through: any mutation flushes immediately
so a crash mid-session can't lose state.

@module pilcrow.articlecache
--]]

local DataStorage = require("datastorage")
local DocSettings = require("docsettings")
local JSON = require("json")
local lfs = require("libs/libkoreader-lfs")
local logger = require("logger")

local CACHE_DIR_NAME = "pilcrow"
local CACHE_FILE = "cache.json"
-- Readeck has a separate on-disk cache so the two backends never mix
-- entries (their ID spaces overlap on small numeric values, and the
-- per-entry payload shape isn't strictly identical). Wallabag keeps
-- the historical "cache.json" filename for backward compatibility.
local CACHE_FILE_BY_KIND = {
    wallabag = "cache.json",
    readeck  = "readeck-cache.json",
}
local SCHEMA_VERSION = 1

local Cache = {}
Cache.__index = Cache

local function ensure_dir(path)
    if lfs.attributes(path, "mode") == "directory" then return true end
    return lfs.mkdir(path)
end

local function default_data()
    return {
        version     = SCHEMA_VERSION,
        last_synced = 0,
        articles    = {},
    }
end

--- Open (or create) the on-disk cache for a backend.
--  @tparam[opt="wallabag"] string kind backend identifier
function Cache.open(kind)
    kind = kind or "wallabag"
    local filename = CACHE_FILE_BY_KIND[kind] or CACHE_FILE
    local dir = DataStorage:getDataDir() .. "/" .. CACHE_DIR_NAME
    ensure_dir(dir)
    local path = dir .. "/" .. filename
    local self = setmetatable({
        kind = kind,
        path = path,
        dir  = dir,
        data = default_data(),
    }, Cache)
    self:_load()
    return self
end

function Cache:_load()
    local fh = io.open(self.path, "r")
    if not fh then return end
    local content = fh:read("*a")
    fh:close()
    if content == "" then return end

    local ok, decoded = pcall(JSON.decode, content)
    if not ok or type(decoded) ~= "table" then
        logger.warn("pilcrow: cache parse failed; starting fresh")
        return
    end
    if decoded.version ~= SCHEMA_VERSION then
        logger.warn("pilcrow: cache version mismatch; starting fresh")
        return
    end
    self.data = decoded
    if type(self.data.articles) ~= "table" then
        self.data.articles = {}
    end
end

function Cache:_flush()
    local tmp = self.path .. ".tmp"
    local encoded = JSON.encode(self.data)
    local fh, err = io.open(tmp, "w")
    if not fh then
        logger.err("pilcrow: cache flush failed:", err)
        return false
    end
    fh:write(encoded)
    fh:close()
    -- rename() replaces the destination atomically on POSIX; removing
    -- first would open a window where a crash leaves no cache at all.
    local ok, rerr = os.rename(tmp, self.path)
    if not ok then
        logger.err("pilcrow: cache rename failed:", rerr)
        return false
    end
    return true
end

------------------------------------------------------------------------
-- Reads
------------------------------------------------------------------------

function Cache:get(id)
    return self.data.articles[tostring(id)]
end

--- Return every article id currently in the cache. Order is whatever
--  `pairs` yields — callers that need a specific order must sort.
--  Used by annotation push and any future cross-article sweeps that
--  need to iterate without going through a filter.
function Cache:listIds()
    local ids = {}
    for id in pairs(self.data.articles) do
        ids[#ids + 1] = id
    end
    return ids
end

function Cache:lastSynced()
    return self.data.last_synced or 0
end

--- True when the article was opened in the reader, has reading
--- progress, and isn't already done. Sidecar reads are cheap when
--- the article has no `local_path` (early-return) — which is the
--- case for everything that was never downloaded.
--- Memoized per cache instance to avoid re-reading the sidecar on
--- every filter/count call; invalidated by `setFlag`/`setLocalPath`
--- when the article's state changes meaningfully.
local function is_in_progress(article, mem)
    if not article or article.is_archived or article.finished then return false end
    -- Key by string: `invalidateProgress` receives ids from callers that
    -- may hold either the numeric Wallabag id or a string; a numeric key
    -- here would never match its tostring()-based removal.
    local id  = tostring(article.id)
    if mem and mem[id] ~= nil then return mem[id] end
    local path = article.local_path
    local result = false
    if path and path ~= ""
       and lfs.attributes(path, "mode") == "file"
       and DocSettings:hasSidecarFile(path) then
        local doc_settings = DocSettings:open(path)
        if doc_settings then
            local summary = doc_settings:readSetting("summary") or {}
            local percent = tonumber(doc_settings:readSetting("percent_finished")) or 0
            if percent > 0 and percent < 1 and summary.status ~= "complete" then
                result = true
            end
        end
    end
    if mem then mem[id] = result end
    return result
end

--- True when the article is read from the user's point of view:
--  archived on the server, or marked read on this device while the
--  archive call couldn't reach the server yet (`finished` — pushed on
--  the next sync). Static helper (plain article table in) so the row
--  menus can label/toggle against the same definition the filters use.
function Cache.isRead(article)
    return (article.is_archived or article.finished) and true or false
end

local function pass_status(article, status, mem)
    if status == "all" or status == nil then return true end
    if status == "unread"      then return not Cache.isRead(article) end
    if status == "starred"     then return article.is_starred  and true or false end
    if status == "archived"    then return Cache.isRead(article) end
    if status == "in_progress" then return is_in_progress(article, mem) end
    return true
end

local function article_has_tag(article, tag)
    for _, t in ipairs(article.tags or {}) do
        if t == tag then return true end
    end
    return false
end

local function pass_tags(article, tags)
    if not tags or #tags == 0 then return true end
    for _, t in ipairs(tags) do
        if not article_has_tag(article, t) then return false end
    end
    return true
end

local function pass_search(article, search)
    if not search or search == "" then return true end
    local hay = ((article.title or "") .. " " .. (article.domain or "")):lower()
    return hay:find(search, 1, true) ~= nil
end

local SORTERS = {
    newest   = function(a, b) return (a.created_at or "") > (b.created_at or "") end,
    oldest   = function(a, b) return (a.created_at or "") < (b.created_at or "") end,
    longest  = function(a, b)
        local ra, rb = a.reading_time or 0, b.reading_time or 0
        if ra == rb then return (a.created_at or "") > (b.created_at or "") end
        return ra > rb
    end,
    shortest = function(a, b)
        -- Articles with unknown reading time (0) sink to the bottom.
        local ra, rb = a.reading_time or 0, b.reading_time or 0
        if (ra == 0) ~= (rb == 0) then return ra ~= 0 end
        if ra == rb then return (a.created_at or "") > (b.created_at or "") end
        return ra < rb
    end,
    domain   = function(a, b)
        local da = (a.domain or ""):lower()
        local db = (b.domain or ""):lower()
        if da == db then return (a.title or ""):lower() < (b.title or ""):lower() end
        return da < db
    end,
}

--- Return a list of articles matching `opts`, sorted per `opts.sort`.
-- @tparam table opts
--   status = "all" | "unread" | "starred" | "archived"  (default: "all")
--   tags   = array of tag strings (intersection)
--   search = case-insensitive substring (matched against title + domain)
--   sort   = "newest" | "oldest" | "longest" | "shortest" | "domain"
function Cache:list(opts)
    opts = opts or {}
    local status = opts.status or "all"
    local search = opts.search and opts.search:lower() or nil
    local sort   = opts.sort or "newest"

    self._progress_mem = self._progress_mem or {}
    local out = {}
    for _, article in pairs(self.data.articles) do
        if pass_status(article, status, self._progress_mem)
           and pass_tags(article, opts.tags)
           and pass_search(article, search) then
            out[#out + 1] = article
        end
    end

    table.sort(out, SORTERS[sort] or SORTERS.newest)
    return out
end

function Cache:count(status)
    -- Lightweight counter; doesn't filter by tags/search.
    self._progress_mem = self._progress_mem or {}
    local n = 0
    for _, article in pairs(self.data.articles) do
        if pass_status(article, status or "all", self._progress_mem) then
            n = n + 1
        end
    end
    return n
end

--- Invalidate the in-progress memoization. Called when an article's
--- state changes in a way that could affect the answer (open, mark
--- finished, archive, delete). Without this the sidecar's freshness
--- gets cached forever for a given session.
function Cache:invalidateProgress(id)
    if not self._progress_mem then return end
    if id then
        self._progress_mem[tostring(id)] = nil
    else
        self._progress_mem = {}
    end
end

--- Return tags with counts, restricted to articles matching `status`.
-- @return array of { tag = "...", count = N }, sorted by count desc, name asc
function Cache:tagCounts(status)
    local counts = {}
    for _, article in pairs(self.data.articles) do
        if pass_status(article, status or "all") then
            for _, tag in ipairs(article.tags or {}) do
                counts[tag] = (counts[tag] or 0) + 1
            end
        end
    end
    local list = {}
    for tag, count in pairs(counts) do
        list[#list + 1] = { tag = tag, count = count }
    end
    table.sort(list, function(a, b)
        if a.count == b.count then return a.tag < b.tag end
        return a.count > b.count
    end)
    return list
end

Cache.SORT_KEYS = { "newest", "oldest", "longest", "shortest", "domain" }
Cache.STATUS_KEYS = { "unread", "in_progress", "starred", "archived", "all" }

------------------------------------------------------------------------
-- Writes
------------------------------------------------------------------------

local function pick_string(article, ...)
    for i = 1, select("#", ...) do
        local key = select(i, ...)
        local value = article[key]
        if type(value) == "string" and value ~= "" then return value end
    end
    return ""
end

local function extract_domain(article)
    local existing = pick_string(article, "domain_name", "domain")
    if existing ~= "" then return existing end
    local url = article.url or article.given_url or ""
    return (url:match("^%w+://([^/]+)") or url):gsub("^www%.", "")
end

local function extract_tags(article)
    local out = {}
    for _, t in ipairs(article.tags or {}) do
        if type(t) == "table" then
            out[#out + 1] = t.label or t.slug or ""
        elseif type(t) == "string" then
            out[#out + 1] = t
        end
    end
    return out
end

--- Upsert an article from a Wallabag API entry. Preserves the fields
--  only this device knows about — local_path, image_path, finished,
--  annotation bookkeeping, and LLM-generated summaries. Dropping
--  pushed_annotations would make every sync re-upload every highlight
--  (the server APIs are not idempotent), and dropping server_annotations
--  would blank the Highlights view on light syncs that skip the pull pass.
function Cache:upsertFromApi(api_article)
    local id = api_article.id
    if not id then return end
    local key = tostring(id)
    local existing = self.data.articles[key] or {}
    self.data.articles[key] = {
        id              = id,
        title           = pick_string(api_article, "title"),
        url             = pick_string(api_article, "url", "given_url"),
        domain          = extract_domain(api_article),
        reading_time    = tonumber(api_article.reading_time) or 0,
        created_at      = pick_string(api_article, "created_at"),
        is_archived     = api_article.is_archived == 1 or api_article.is_archived == true,
        is_starred      = api_article.is_starred  == 1 or api_article.is_starred  == true,
        tags            = extract_tags(api_article),
        preview_picture = pick_string(api_article, "preview_picture"),
        local_path      = existing.local_path,
        image_path      = existing.image_path,
        finished        = existing.finished or false,
        pushed_annotations = existing.pushed_annotations,
        server_annotations = existing.server_annotations,
        summary            = existing.summary,
        summary_model      = existing.summary_model,
    }
end

function Cache:setLocalPath(id, path)
    local entry = self.data.articles[tostring(id)]
    if not entry then return end
    entry.local_path = path
    self:invalidateProgress(id)
end

function Cache:setFlag(id, key, value)
    local entry = self.data.articles[tostring(id)]
    if not entry then return end
    entry[key] = value
    -- Any of these can flip the in-progress verdict.
    if key == "finished" or key == "is_archived" or key == "local_path" then
        self:invalidateProgress(id)
    end
end

function Cache:remove(id)
    self.data.articles[tostring(id)] = nil
    self:invalidateProgress(id)
end

function Cache:markSynced()
    self.data.last_synced = os.time()
end

function Cache:save()
    return self:_flush()
end

return Cache
