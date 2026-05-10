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
            finished    = boolean,     -- pushed to server?
        },
        ...
    },
}

The cache is intentionally write-through: any mutation flushes immediately
so a crash mid-session can't lose state.

@module pilcrow.articlecache
--]]

local DataStorage = require("datastorage")
local JSON = require("json")
local lfs = require("libs/libkoreader-lfs")
local logger = require("logger")

local CACHE_DIR_NAME = "pilcrow"
local CACHE_FILE = "cache.json"
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

function Cache.open()
    local dir = DataStorage:getDataDir() .. "/" .. CACHE_DIR_NAME
    ensure_dir(dir)
    local path = dir .. "/" .. CACHE_FILE
    local self = setmetatable({
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
    os.remove(self.path)
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

function Cache:lastSynced()
    return self.data.last_synced or 0
end

local function pass_status(article, status)
    if status == "all" or status == nil then return true end
    if status == "unread"   then return not article.is_archived end
    if status == "starred"  then return article.is_starred and true or false end
    if status == "archived" then return article.is_archived and true or false end
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

    local out = {}
    for _, article in pairs(self.data.articles) do
        if pass_status(article, status)
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
    local n = 0
    for _, article in pairs(self.data.articles) do
        if pass_status(article, status or "all") then n = n + 1 end
    end
    return n
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
Cache.STATUS_KEYS = { "unread", "starred", "archived", "all" }

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

--- Upsert an article from a Wallabag API entry. Preserves local_path,
--  image_path and finished from any existing cache row.
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
    }
end

function Cache:setLocalPath(id, path)
    local entry = self.data.articles[tostring(id)]
    if not entry then return end
    entry.local_path = path
end

function Cache:setFlag(id, key, value)
    local entry = self.data.articles[tostring(id)]
    if not entry then return end
    entry[key] = value
end

function Cache:remove(id)
    self.data.articles[tostring(id)] = nil
end

function Cache:markSynced()
    self.data.last_synced = os.time()
end

function Cache:save()
    return self:_flush()
end

return Cache
