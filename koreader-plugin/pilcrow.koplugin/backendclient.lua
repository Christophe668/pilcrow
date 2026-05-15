--[[--
Backend factory for Pilcrow.

Pilcrow speaks two flavours of read-it-later API:

  * **Wallabag** (default) — OAuth2 password grant, integer IDs, REST
    payloads form-encoded. Credentials come from the original
    `wallabag.koplugin` settings file.
  * **Readeck** — long-lived bearer tokens, string IDs, JSON payloads.
    Credentials live in `readeck.lua` under the plugin settings dir.

This module exposes a single `BackendClient.new(settings)` that picks
the right concrete client based on the plugin's `backend` setting (or
falls back to "wallabag" for installs that predate the switch). Both
concrete clients implement the same surface — see
`wallabagclient.lua` for the canonical contract — so the rest of the
plugin treats the result polymorphically.

`BackendClient` also adds two read-only fields the rest of the plugin
inspects:

  * `kind`              — "wallabag" or "readeck"
  * `supports_reload`   — whether `reloadEntry` actually does anything
                          (Wallabag yes, Readeck no)

@module pilcrow.backendclient
--]]

local WallabagClient = require("wallabagclient")
local ReadeckClient   = require("readeckclient")

local M = {}

local DEFAULT_BACKEND = "wallabag"

local function pick_kind(settings)
    if not settings then return DEFAULT_BACKEND end
    local k = settings:get("backend")
    if k == "readeck" or k == "wallabag" then return k end
    return DEFAULT_BACKEND
end

--- Build a fresh client for the configured backend.
--  @tparam table settings Pilcrow settings (the one returned by
--    `settingsview.open`); may be nil during early init.
--  @treturn table client + `kind` + `supports_reload`
function M.new(settings)
    local kind = pick_kind(settings)
    local client
    if kind == "readeck" then
        client = ReadeckClient.new()
        client.kind = "readeck"
        client.supports_reload = false
    else
        client = WallabagClient.new()
        client.kind = "wallabag"
        client.supports_reload = true
    end
    return client
end

M.DEFAULT_BACKEND = DEFAULT_BACKEND
M.KINDS = { "wallabag", "readeck" }

return M
