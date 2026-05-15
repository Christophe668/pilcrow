--[[--
Thin Wallabag REST client for Pilcrow.

This module reuses the **same on-disk credentials** the original
`wallabag.koplugin` writes to (`<settings_dir>/wallabag.lua`, key
`wallabag`). It does NOT define a second credentials UI: configure once
in the original plugin, both work.

The HTTP/OAuth2 layer is implemented inline because the original
plugin keeps its client as private instance methods on a `WidgetContainer`
that we cannot easily address from here. The auth flow is identical
(password grant + refresh).

@module pilcrow.wallabagclient
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
local TOKEN_REFRESH_GRACE = 60

local Client = {}
Client.__index = Client

local function shared_settings_path()
    return DataStorage:getSettingsDir() .. "/wallabag.lua"
end

function Client.new()
    local store = LuaSettings:open(shared_settings_path())
    -- Mirror the existing plugin's expectation: a `wallabag` sub-table.
    local creds = store:readSetting("wallabag") or {}
    return setmetatable({
        store = store,
        creds = creds,
        access_token = nil,
        refresh_token = nil,
        token_expiry = 0,
    }, Client)
end

function Client:reload()
    self.creds = self.store:readSetting("wallabag") or {}
    self.access_token = nil
    self.refresh_token = nil
    self.token_expiry = 0
end

function Client:isConfigured()
    local required = { "server_url", "client_id", "client_secret", "username", "password" }
    for _, key in ipairs(required) do
        local v = self.creds[key]
        if v == nil or v == "" then return false, key end
    end
    return true
end

local function strip_trailing_slash(url)
    if not url or url == "" then return url end
    return (url:gsub("/+$", ""))
end

local function urlencode(s)
    if not s then return "" end
    return (s:gsub("([^%w%-_%.~])", function(c)
        return string.format("%%%02X", string.byte(c))
    end))
end

local function form_encode(params)
    local parts = {}
    for k, v in pairs(params) do
        parts[#parts + 1] = urlencode(k) .. "=" .. urlencode(tostring(v))
    end
    return table.concat(parts, "&")
end

------------------------------------------------------------------------
-- Low-level request
------------------------------------------------------------------------

function Client:_request(method, url_or_path, body, extra_headers, file_path)
    local request = { method = method }
    local headers = {}

    if url_or_path:sub(1, 1) == "/" then
        request.url = strip_trailing_slash(self.creds.server_url or "") .. url_or_path
        if self.access_token then
            headers["Authorization"] = "Bearer " .. self.access_token
        end
    else
        request.url = url_or_path
    end

    if extra_headers then
        for k, v in pairs(extra_headers) do headers[k] = v end
    end

    if body then
        request.source = ltn12.source.string(body)
        headers["Content-Length"] = tostring(#body)
        if not headers["Content-Type"] then
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        end
    end

    request.headers = headers

    local sink = {}
    if file_path then
        local fh, ferr = io.open(file_path, "wb")
        if not fh then
            logger.err("pilcrow: cannot open download target", file_path, ferr)
            return false, "io_error"
        end
        request.sink = ltn12.sink.file(fh)
        socketutil:set_timeout(FILE_BLOCK_TIMEOUT, FILE_TOTAL_TIMEOUT)
    else
        request.sink = ltn12.sink.table(sink)
        socketutil:set_timeout(API_BLOCK_TIMEOUT, API_TOTAL_TIMEOUT)
    end

    logger.dbg("pilcrow:", method, request.url)
    local code, resp_headers, status = socket.skip(1, http.request(request))
    socketutil:reset_timeout()

    if resp_headers == nil then
        if file_path then os.remove(file_path) end
        return false, "network_error"
    end

    if code < 200 or code >= 300 then
        logger.warn("pilcrow: HTTP error", code, status, "for", request.url)
        if file_path then os.remove(file_path) end
        return false, "http_error", code, status
    end

    if file_path then return true, file_path end

    local content = table.concat(sink)
    if content == "" then return true, {} end
    local ok, decoded = pcall(JSON.decode, content)
    if not ok or decoded == nil then
        return false, "json_error"
    end
    return true, decoded
end

------------------------------------------------------------------------
-- Auth
------------------------------------------------------------------------

function Client:ensureToken()
    local now = os.time()
    if self.access_token and now < (self.token_expiry - TOKEN_REFRESH_GRACE) then
        return true
    end

    local ok_cfg, missing = self:isConfigured()
    if not ok_cfg then return false, "not_configured", missing end

    local params
    if self.refresh_token then
        params = {
            grant_type    = "refresh_token",
            refresh_token = self.refresh_token,
            client_id     = self.creds.client_id,
            client_secret = self.creds.client_secret,
        }
    else
        params = {
            grant_type    = "password",
            client_id     = self.creds.client_id,
            client_secret = self.creds.client_secret,
            username      = self.creds.username,
            password      = self.creds.password,
        }
    end

    local saved = self.access_token
    self.access_token = nil
    local ok, data, http_code = self:_request("POST", "/oauth/v2/token", form_encode(params))
    if not ok then
        self.access_token = saved
        if data == "http_error" and self.refresh_token then
            self.refresh_token = nil
            return self:ensureToken()
        end
        return false, data, http_code
    end

    if type(data) ~= "table" or not data.access_token then
        return false, "auth_error"
    end

    self.access_token  = data.access_token
    self.refresh_token = data.refresh_token
    self.token_expiry  = os.time() + (tonumber(data.expires_in) or 3600)
    return true
end

local function with_auth(self, fn)
    local ok, err, code = self:ensureToken()
    if not ok then return false, err, code end
    return fn()
end

------------------------------------------------------------------------
-- Public API
------------------------------------------------------------------------

--- Iterate all entries matching `opts`, paginating server-side. Returns a
--  flat array of API entry tables.
function Client:listEntries(opts)
    opts = opts or {}
    local per_page = opts.perPage or 30
    local archive  = opts.archive
    local starred  = opts.starred
    local tags     = opts.tags

    local results = {}
    local page = 1
    while true do
        local query = { string.format("perPage=%d", per_page),
                        string.format("page=%d", page),
                        "sort=created", "order=desc" }
        if archive ~= nil then query[#query + 1] = "archive=" .. tostring(archive) end
        if starred ~= nil then query[#query + 1] = "starred=" .. tostring(starred) end
        if tags and tags ~= "" then query[#query + 1] = "tags=" .. urlencode(tags) end

        local path = "/api/entries.json?" .. table.concat(query, "&")
        local ok, data = with_auth(self, function() return self:_request("GET", path) end)
        if not ok then return false, data end

        local items = (data._embedded and data._embedded.items) or {}
        for _, item in ipairs(items) do results[#results + 1] = item end

        if opts.on_progress then opts.on_progress(page, #results) end

        local pages = tonumber(data.pages) or 1
        if page >= pages or #items == 0 then break end
        page = page + 1
        if #results >= (opts.maxItems or 500) then break end
    end
    return true, results
end

function Client:downloadEntry(id, file_path, format)
    format = format or "epub"
    return with_auth(self, function()
        return self:_request("GET",
            string.format("/api/entries/%d/export.%s", id, format),
            nil, nil, file_path)
    end)
end

function Client:archiveEntry(id)
    return with_auth(self, function()
        return self:_request("PATCH",
            string.format("/api/entries/%d.json", id),
            form_encode({ archive = 1 }))
    end)
end

function Client:unarchiveEntry(id)
    return with_auth(self, function()
        return self:_request("PATCH",
            string.format("/api/entries/%d.json", id),
            form_encode({ archive = 0 }))
    end)
end

function Client:starEntry(id, starred)
    return with_auth(self, function()
        return self:_request("PATCH",
            string.format("/api/entries/%d.json", id),
            form_encode({ starred = starred and 1 or 0 }))
    end)
end

function Client:deleteEntry(id)
    return with_auth(self, function()
        return self:_request("DELETE", string.format("/api/entries/%d.json", id))
    end)
end

function Client:addEntry(url, tags)
    return with_auth(self, function()
        return self:_request("POST", "/api/entries.json",
            form_encode({ url = url, tags = tags or "" }))
    end)
end

--- Download an arbitrary URL to a file. Used for `preview_picture`
--  thumbnails. No auth header is sent — these are typically public
--  resources (Wallabag preview hosts or original source CDNs).
function Client:downloadUrl(url, file_path)
    if not url or url == "" then return false, "empty_url" end
    return self:_request("GET", url, nil, nil, file_path)
end

--- Tell the server to re-fetch the article from its source URL.
--  Useful when Wallabag's first fetch failed (the EPUB contains
--  "wallabag can't retrieve contents for this article") — sometimes
--  the source becomes reachable, anti-bot walls relax, or the site
--  config gets a fix server-side. Returns the refreshed entry on
--  success.
function Client:reloadEntry(id)
    return with_auth(self, function()
        return self:_request("PATCH",
            string.format("/api/entries/%d/reload.json", id))
    end)
end

return Client
