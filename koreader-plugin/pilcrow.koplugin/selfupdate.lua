--[[--
Self-update: fetch the latest release from GitHub, extract it on top of
the running plugin directory, then ask the user to restart KOReader.

The flow has three steps:

  1. `fetchLatestRelease(repo)` — calls the GitHub Releases API and
     parses the JSON.
  2. `download(url, dest_path)` — streams the asset to a temp file.
  3. `applyUpdate(release, plugin_dir)` — unzips into a temp scratch
     directory, finds `pilcrow.koplugin/` inside the archive (any
     nesting depth) and copies its contents over the running plugin
     dir. The running Lua VM caches modules in memory, so files-in-use
     aren't a problem on POSIX — the next launch picks up the new
     code.

The actual restart is delegated to the caller (main.lua hands the
user a ConfirmBox with an Exit button); broadcasting `Restart` from
inside the update path is fragile when the UIManager is mid-modal.

Expected release shape: a `.zip` asset named `pilcrow*.zip` containing
`pilcrow.koplugin/` at any depth. Falls back to GitHub's auto-generated
`zipball_url` if no matching asset is found, which works for repos that
tag a release without uploading binaries.

@module pilcrow.selfupdate
--]]

local DataStorage = require("datastorage")
local JSON = require("json")
local http = require("socket.http")
local logger = require("logger")
local ltn12 = require("ltn12")
local socket = require("socket")
local socketutil = require("socketutil")
local _ = require("gettext")
local T = require("ffi/util").template

local API_BLOCK_TIMEOUT  = 10
local API_TOTAL_TIMEOUT  = 30
local FILE_BLOCK_TIMEOUT = 30
local FILE_TOTAL_TIMEOUT = 300

local M = {}

local function shell_quote(s)
    -- Single-quoted, with embedded single quotes escaped as '\''. Safe
    -- against directory names that may contain spaces, hyphens, or
    -- (in theory) shell metacharacters.
    return "'" .. tostring(s):gsub("'", "'\\''") .. "'"
end

local function http_get(url, file_path)
    local request = {
        method = "GET",
        url = url,
        headers = {
            ["User-Agent"] = "pilcrow-koreader-selfupdate",
            ["Accept"] = file_path and "*/*" or "application/vnd.github+json",
        },
    }
    local sink_t
    if file_path then
        local fh, ferr = io.open(file_path, "wb")
        if not fh then
            logger.err("pilcrow/selfupdate: cannot open", file_path, ferr)
            return false, "io_error"
        end
        request.sink = ltn12.sink.file(fh)
        socketutil:set_timeout(FILE_BLOCK_TIMEOUT, FILE_TOTAL_TIMEOUT)
    else
        sink_t = {}
        request.sink = ltn12.sink.table(sink_t)
        socketutil:set_timeout(API_BLOCK_TIMEOUT, API_TOTAL_TIMEOUT)
    end

    logger.dbg("pilcrow/selfupdate: GET", url)
    local code, headers, status = socket.skip(1, http.request(request))
    socketutil:reset_timeout()

    if type(code) ~= "number" then
        if file_path then os.remove(file_path) end
        return false, type(code) == "string" and code or "network_error"
    end
    if code < 200 or code >= 300 then
        if file_path then os.remove(file_path) end
        return false, T(_("HTTP %1"), tostring(code))
    end

    if file_path then return true, file_path end
    return true, table.concat(sink_t)
end

------------------------------------------------------------------------
-- Public surface
------------------------------------------------------------------------

--- Compare two version strings of the form "vX.Y.Z" / "X.Y.Z".
-- Tokens beyond patch (rc, beta, …) are not supported; the comparator
-- treats them as equal so users on a pre-release don't get bumped to a
-- non-existent stable. Returns -1, 0, 1 like a Unix cmp.
function M.compareVersions(a, b)
    local function parts(v)
        -- Drop any non-numeric tag prefix ("koplugin-v2026.07.1") before
        -- stripping pre-release/build suffixes ("-rc1", "+build5") —
        -- otherwise a hyphen in the prefix swallows the whole version
        -- and every release compares as 0.0.0. The suffix strip itself
        -- matters because "0.2.0-rc1"'s digits would otherwise count as
        -- extra version components and sort above "0.2.0".
        local base = tostring(v or ""):match("%d.*") or ""
        base = base:gsub("[-+].*$", "")
        local out = {}
        for n in base:gmatch("(%d+)") do
            out[#out + 1] = tonumber(n)
        end
        return out
    end
    local pa, pb = parts(a), parts(b)
    for i = 1, math.max(#pa, #pb) do
        local va = pa[i] or 0
        local vb = pb[i] or 0
        if va ~= vb then return va < vb and -1 or 1 end
    end
    return 0
end

function M.fetchLatestRelease(repo)
    if not repo or not repo:match("^[%w%-_.]+/[%w%-_.]+$") then
        return false, "bad_repo"
    end
    local url = "https://api.github.com/repos/" .. repo .. "/releases/latest"
    local ok, body = http_get(url)
    if not ok then return false, body end

    local parsed
    local pok = pcall(function() parsed = JSON.decode(body) end)
    if not pok or type(parsed) ~= "table" then return false, "json_error" end
    return true, parsed
end

local function find_zip_asset(release)
    if type(release.assets) ~= "table" then return nil end
    for _, a in ipairs(release.assets) do
        local name = a.name or ""
        if name:lower():match("%.zip$") and name:lower():find("pilcrow", 1, true) then
            return a.browser_download_url, name
        end
    end
    return nil
end

--- Download + extract over the plugin directory. Returns `true` on
-- success, or `false, reason` (string) on failure. Best-effort cleanup
-- of the temp scratch directory whether we succeed or not.
function M.applyUpdate(release, plugin_dir)
    local url, asset_name = find_zip_asset(release)
    if not url then
        url = release.zipball_url
        asset_name = "pilcrow-source.zip"
    end
    if not url then return false, "no_asset" end

    local tmp_dir = DataStorage:getDataDir() .. "/pilcrow-update"
    os.execute("rm -rf " .. shell_quote(tmp_dir))
    if os.execute("mkdir -p " .. shell_quote(tmp_dir)) ~= 0 then
        return false, "mkdir_failed"
    end
    -- The asset name comes from the release JSON — flatten any path
    -- separators so a hostile/typoed `update_repo` can't write outside
    -- the scratch dir.
    local tmp_zip = tmp_dir .. "/" .. asset_name:gsub("[/\\]", "_")

    local ok, err = http_get(url, tmp_zip)
    if not ok then
        os.execute("rm -rf " .. shell_quote(tmp_dir))
        return false, err
    end

    -- Quiet `unzip` (`-q`) so stdout doesn't pollute the KOReader log.
    local unzip_cmd = string.format("unzip -q -o %s -d %s",
        shell_quote(tmp_zip), shell_quote(tmp_dir))
    if os.execute(unzip_cmd) ~= 0 then
        os.execute("rm -rf " .. shell_quote(tmp_dir))
        return false, "unzip_failed"
    end

    -- Locate `pilcrow.koplugin/` inside the extracted tree (it can be
    -- at root or nested one directory deep for source-zipballs).
    local find_cmd = string.format(
        "find %s -type d -name pilcrow.koplugin 2>/dev/null | head -n 1",
        shell_quote(tmp_dir))
    local pipe = io.popen(find_cmd)
    local src_dir = pipe and (pipe:read("*l") or "")
    if pipe then pipe:close() end
    src_dir = src_dir and src_dir:gsub("%s+$", "") or ""
    if src_dir == "" then
        os.execute("rm -rf " .. shell_quote(tmp_dir))
        return false, "structure_unexpected"
    end

    -- `cp -R src/. dest` copies the contents of src into dest without
    -- creating a nested src/ — works whether dest exists or not.
    local copy_cmd = string.format("cp -R %s/. %s",
        shell_quote(src_dir), shell_quote(plugin_dir))
    if os.execute(copy_cmd) ~= 0 then
        os.execute("rm -rf " .. shell_quote(tmp_dir))
        return false, "copy_failed"
    end

    os.execute("rm -rf " .. shell_quote(tmp_dir))
    return true
end

return M
