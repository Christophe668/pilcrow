--[[--
Shared bootstrap for the plugin's plain-Lua unit tests.

Run tests from the repo root with:  lua koreader-plugin/tests/test_*.lua
KOReader-only modules are stubbed via package.preload so plugin modules
load under a stock Lua interpreter (5.1 or 5.4).
--]]

local M = {}

function M.setup()
    -- arg[0] is e.g. "koreader-plugin/tests/test_summarizer.lua"
    local root = arg and arg[0] and arg[0]:match("^(.*)/tests/") or "koreader-plugin"
    package.path = root .. "/pilcrow.koplugin/?.lua;" .. package.path

    package.preload["logger"] = function()
        local noop = function() end
        return { dbg = noop, info = noop, warn = noop, err = noop }
    end
    package.preload["gettext"] = function()
        return function(s) return s end
    end
    package.preload["json"] = function()
        return {
            encode = function() return "{}" end,
            decode = function() return nil end,
        }
    end
    package.preload["socket"] = function()
        return { skip = function(n, ...) return select(n + 1, ...) end }
    end
    package.preload["socket.http"] = function()
        return { request = function() return nil end }
    end
    package.preload["ltn12"] = function()
        return {
            source = { string = function() end },
            sink = { table = function() end, file = function() end },
        }
    end
    package.preload["socketutil"] = function()
        return { set_timeout = function() end, reset_timeout = function() end }
    end
    package.preload["datastorage"] = function()
        return {
            getDataDir = function() return "/tmp/pilcrow-test" end,
            getSettingsDir = function() return "/tmp/pilcrow-test" end,
        }
    end
    package.preload["docsettings"] = function()
        return { hasSidecarFile = function() return false end }
    end
    package.preload["libs/libkoreader-lfs"] = function()
        return {
            attributes = function() return nil end,
            mkdir = function() return true end,
            dir = function() return function() return nil end end,
        }
    end
end

local passed, failed = 0, 0

function M.check(name, cond, detail)
    if cond then
        passed = passed + 1
    else
        failed = failed + 1
        io.write("FAIL: ", name, detail and (" — " .. tostring(detail)) or "", "\n")
    end
end

function M.eq(name, got, want)
    M.check(name, got == want,
        string.format("got %q, want %q", tostring(got), tostring(want)))
end

function M.finish()
    io.write(string.format("%d passed, %d failed\n", passed, failed))
    os.exit(failed == 0 and 0 or 1)
end

return M
