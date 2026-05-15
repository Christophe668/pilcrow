--[[--
Thin Readeck REST client for Pilcrow.

Readeck uses long-lived bearer tokens (issued via the device-code OAuth
flow or generated manually from the user's profile page). There is no
refresh dance — the token is presented as `Authorization: Bearer …` on
every request. If the server returns 401 the session is unrecoverable;
the user must sign in again.

Credentials live in `<settings_dir>/readeck.lua` under the `readeck`
sub-table. Required fields: `server_url`, `access_token`.

This module mirrors the public surface of `wallabagclient.lua` so the
rest of the plugin can call either backend through a thin factory:
`isConfigured`, `reload`, `listEntries`, `downloadEntry`,
`archiveEntry`, `unarchiveEntry`, `starEntry`, `deleteEntry`,
`addEntry`, `downloadUrl`, `reloadEntry`.

`listEntries` returns entries in a Wallabag-shaped record (id, title,
url, domain, reading_time, created_at, is_archived, is_starred, tags,
preview_picture) so `articlecache.upsertFromApi` ingests Readeck and
Wallabag data through the same path without a schema fork.

@module pilcrow.readeckclient
--]]

local DataStorage = require("datastorage")
local JSON = require("json")
local LuaSettings = require("luasettings")
local http = require("socket.http")
local logger = require("logger")
local ltn12 = require("ltn12")
local socket = require("socket")
local socketutil = require("socketutil")

local API_BLOCK_TIMEOUT = 10
local API_TOTAL_TIMEOUT = 30
local FILE_BLOCK_TIMEOUT = 30
local FILE_TOTAL_TIMEOUT = 300

local Client = {}
Client.__index = Client

local SETTINGS_FILE = "readeck.lua"
local SETTINGS_KEY = "readeck"

local function settings_path()
    return DataStorage:getSettingsDir() .. "/" .. SETTINGS_FILE
end

function Client.new()
    local store = LuaSettings:open(settings_path())
    local creds = store:readSetting(SETTINGS_KEY) or {}
    return setmetatable({
        store = store,
        creds = creds,
    }, Client)
end

function Client:reload()
    self.creds = self.store:readSetting(SETTINGS_KEY) or {}
end

function Client:isConfigured()
    local required = { "server_url", "access_token" }
    for _, key in ipairs(required) do
        local v = self.creds[key]
        if v == nil or v == "" then return false, key end
    end
    return true
end

function Client:saveCreds(creds)
    self.creds = creds or {}
    self.store:saveSetting(SETTINGS_KEY, self.creds)
    self.store:flush()
end

function Client:get(key)
    return self.creds[key]
end

local function strip_trailing_slash(url)
    if not url or url == "" then return url end
    return (url:gsub("/+$", ""))
end

--- Normalise a user-entered server URL so a bare hostname like
--- "readeck.example.com" still produces a valid request: KOReader's
--- `socket.http` dispatches on the URL scheme, and without one it
--- silently fails with no useful error. Default to `https://` since
--- Readeck almost always runs over TLS — a user on a local HTTP
--- instance can paste the full `http://` URL explicitly.
local function normalize_server_url(url)
    if not url or url == "" then return url end
    url = url:gsub("^%s+", ""):gsub("%s+$", "")
    url = strip_trailing_slash(url)
    if not url:match("^https?://") then
        url = "https://" .. url
    end
    return url
end

local function urlencode(s)
    if not s then return "" end
    return (s:gsub("([^%w%-_%.~])", function(c)
        return string.format("%%%02X", string.byte(c))
    end))
end

------------------------------------------------------------------------
-- Low-level request
--
-- `url_or_path` starting with "/" is resolved against `server_url`;
-- anything else is taken verbatim (used by `downloadUrl` for preview
-- pictures that the server hands back as absolute URLs).
--
-- `body` is a JSON-encoded string (or nil). The Authorization header is
-- attached on absolute-path requests AND on absolute URLs that point
-- back to the Readeck server, since Readeck preview/thumbnail resources
-- live on the same host behind the same bearer-auth wall.
------------------------------------------------------------------------

function Client:_request(method, url_or_path, body, extra_headers, file_path, opts)
    opts = opts or {}
    local request = { method = method }
    local headers = {}

    local server = normalize_server_url(self.creds.server_url or "")
    local final_url
    local same_origin = false
    if url_or_path:sub(1, 1) == "/" then
        final_url = server .. url_or_path
        same_origin = true
    else
        final_url = url_or_path
        if server ~= "" and url_or_path:sub(1, #server) == server then
            same_origin = true
        end
    end
    request.url = final_url

    if same_origin and self.creds.access_token and not opts.no_auth then
        headers["Authorization"] = "Bearer " .. self.creds.access_token
    end

    if opts.accept then
        headers["Accept"] = opts.accept
    end

    if extra_headers then
        for k, v in pairs(extra_headers) do headers[k] = v end
    end

    if body then
        request.source = ltn12.source.string(body)
        headers["Content-Length"] = tostring(#body)
        if not headers["Content-Type"] then
            headers["Content-Type"] = "application/json"
        end
    end

    request.headers = headers

    local sink = {}
    if file_path then
        local fh, ferr = io.open(file_path, "wb")
        if not fh then
            logger.err("pilcrow/readeck: cannot open download target", file_path, ferr)
            return false, "io_error"
        end
        request.sink = ltn12.sink.file(fh)
        socketutil:set_timeout(FILE_BLOCK_TIMEOUT, FILE_TOTAL_TIMEOUT)
    else
        request.sink = ltn12.sink.table(sink)
        socketutil:set_timeout(API_BLOCK_TIMEOUT, API_TOTAL_TIMEOUT)
    end

    logger.dbg("pilcrow/readeck:", method, request.url)
    local code, resp_headers, status = socket.skip(1, http.request(request))
    socketutil:reset_timeout()

    if resp_headers == nil then
        -- When luasocket's http.request fails before getting a
        -- response (DNS, TCP refused, TLS handshake, …) the first
        -- return value is a string error; after `socket.skip(1, …)`
        -- that string lands in `code`. Surface it so the user sees
        -- the real cause instead of a generic "network_error".
        local err = type(code) == "string" and code or "network_error"
        logger.warn("pilcrow/readeck: request failed for", request.url, "→", err)
        if file_path then os.remove(file_path) end
        return false, err
    end

    if code < 200 or code >= 300 then
        logger.warn("pilcrow/readeck: HTTP error", code, status, "for", request.url)
        if file_path then os.remove(file_path) end
        return false, "http_error", code, status, resp_headers
    end

    if file_path then return true, file_path end

    local content = table.concat(sink)
    if opts.return_headers then
        if content == "" then return true, {}, resp_headers end
        local ok, decoded = pcall(JSON.decode, content)
        if not ok or decoded == nil then return false, "json_error" end
        return true, decoded, resp_headers
    end

    if content == "" then return true, {} end
    local ok, decoded = pcall(JSON.decode, content)
    if not ok or decoded == nil then return false, "json_error" end
    return true, decoded
end

------------------------------------------------------------------------
-- Auth bootstrap
--
-- Bearer tokens are long-lived; the only thing to check before each
-- call is that we actually have one. `with_auth` is the matching
-- helper for `wallabagclient.lua` so call sites stay symmetric.
------------------------------------------------------------------------

function Client:ensureToken()
    local ok, missing = self:isConfigured()
    if not ok then return false, "not_configured", missing end
    return true
end

local function with_auth(self, fn)
    local ok, err, code = self:ensureToken()
    if not ok then return false, err, code end
    return fn()
end

------------------------------------------------------------------------
-- Normalization
--
-- Bend a Readeck bookmark into the Wallabag-shaped record the cache's
-- `upsertFromApi` already knows how to swallow. Only the fields the
-- cache reads need to be present; everything else is a no-op.
------------------------------------------------------------------------

local function pick_preview(b)
    local r = b.resources or {}
    if r.image and r.image.src and r.image.src ~= "" then return r.image.src end
    if r.thumbnail and r.thumbnail.src and r.thumbnail.src ~= "" then return r.thumbnail.src end
    return ""
end

local function extract_domain(b)
    local site = b.site
    if type(site) == "string" and site ~= "" then return site end
    local url = b.url or ""
    return (url:match("^%w+://([^/]+)") or url):gsub("^www%.", "")
end

local function to_wallabag_shape(b)
    return {
        id              = b.id,
        title           = b.title or "",
        url             = b.url or "",
        domain          = extract_domain(b),
        reading_time    = tonumber(b.reading_time) or 0,
        created_at      = b.created or "",
        is_archived     = b.is_archived and true or false,
        is_starred      = b.is_marked and true or false,
        tags            = b.labels or {},
        preview_picture = pick_preview(b),
    }
end

------------------------------------------------------------------------
-- Public API
------------------------------------------------------------------------

--- Iterate bookmarks matching `opts`, paginating via limit/offset.
--  Returns a flat array of normalized entries.
--  Recognized opts: perPage, maxItems, archive (0|1), starred (0|1),
--  tags (string — comma/AND list passed as `labels`).
function Client:listEntries(opts)
    opts = opts or {}
    local per_page = math.min(opts.perPage or 30, 100)  -- server caps at 100
    local max_items = opts.maxItems or 500

    local function as_bool_str(v)
        if v == true or v == 1 then return "true" end
        if v == false or v == 0 then return "false" end
        return nil
    end

    local query_base = { string.format("limit=%d", per_page) }
    if opts.archive ~= nil then
        local b = as_bool_str(opts.archive)
        if b then query_base[#query_base + 1] = "is_archived=" .. b end
    end
    if opts.starred ~= nil then
        local b = as_bool_str(opts.starred)
        if b then query_base[#query_base + 1] = "is_marked=" .. b end
    end
    if opts.tags and opts.tags ~= "" then
        query_base[#query_base + 1] = "labels=" .. urlencode(opts.tags)
    end

    local results = {}
    local offset = 0
    local page = 0
    while true do
        local query = {}
        for i = 1, #query_base do query[i] = query_base[i] end
        query[#query + 1] = string.format("offset=%d", offset)
        local path = "/api/bookmarks?" .. table.concat(query, "&")
        local ok, data, resp_headers = with_auth(self, function()
            return self:_request("GET", path, nil, nil, nil, { return_headers = true })
        end)
        if not ok then return false, data end
        if type(data) ~= "table" then return false, "json_error" end

        local count = 0
        for _, b in ipairs(data) do
            results[#results + 1] = to_wallabag_shape(b)
            count = count + 1
        end

        page = page + 1
        if opts.on_progress then opts.on_progress(page, #results) end

        if count == 0 then break end
        offset = offset + count

        -- Honour Total-Count when the server reports it; otherwise stop
        -- when the page came back short.
        local total = resp_headers and (resp_headers["total-count"] or resp_headers["Total-Count"])
        total = tonumber(total)
        if total and offset >= total then break end
        if count < per_page then break end
        if #results >= max_items then break end
    end
    return true, results
end

local function bookmark_path(id)
    return "/api/bookmarks/" .. urlencode(tostring(id))
end

--- Download an article in `format` (epub, md, etc.) to `file_path`.
function Client:downloadEntry(id, file_path, format)
    format = format or "epub"
    return with_auth(self, function()
        return self:_request("GET",
            bookmark_path(id) .. "/article." .. format,
            nil, nil, file_path)
    end)
end

local function patch_bookmark(self, id, payload)
    return with_auth(self, function()
        return self:_request("PATCH", bookmark_path(id), JSON.encode(payload))
    end)
end

function Client:archiveEntry(id)
    return patch_bookmark(self, id, { is_archived = true })
end

function Client:unarchiveEntry(id)
    return patch_bookmark(self, id, { is_archived = false })
end

function Client:starEntry(id, starred)
    return patch_bookmark(self, id, { is_marked = starred and true or false })
end

function Client:deleteEntry(id)
    return with_auth(self, function()
        return self:_request("DELETE", bookmark_path(id))
    end)
end

--- Create a new bookmark. Returns `(true, { id = <new-id> })` on
--  success. Readeck answers 202 Accepted with the new id in the
--  `Bookmark-Id` header; the body is empty.
function Client:addEntry(url, tags)
    local body = { url = url }
    if tags and tags ~= "" then
        local labels = {}
        for raw in tags:gmatch("[^,]+") do
            local trimmed = raw:gsub("^%s+", ""):gsub("%s+$", "")
            if trimmed ~= "" then labels[#labels + 1] = trimmed end
        end
        if #labels > 0 then body.labels = labels end
    end
    local ok, data, resp_headers = with_auth(self, function()
        return self:_request("POST", "/api/bookmarks", JSON.encode(body),
            nil, nil, { return_headers = true })
    end)
    if not ok then return false, data end
    local id = resp_headers and (resp_headers["bookmark-id"] or resp_headers["Bookmark-Id"])
    if not id then return false, "missing_bookmark_id" end
    return true, { id = id }
end

--- Download an arbitrary URL to a file. Used for preview-picture
--  thumbnails. Readeck's preview resources are server-hosted and
--  bearer-authenticated, so `_request` automatically attaches the
--  token when the URL points back to the configured server.
function Client:downloadUrl(url, file_path)
    if not url or url == "" then return false, "empty_url" end
    return self:_request("GET", url, nil, nil, file_path)
end

--- Readeck has no equivalent of Wallabag's `/reload` endpoint — the
--  extractor runs once at create-time and re-extraction isn't exposed
--  in the public API. Surface a sentinel so callers can branch on it
--  the same way they would on an HTTP error.
function Client:reloadEntry(_id)
    return false, "not_supported"
end

Client.supports_reload = false

return Client
