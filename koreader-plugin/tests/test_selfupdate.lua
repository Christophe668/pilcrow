local H = dofile(arg[0]:match("^(.*)/") .. "/helpers.lua")
H.setup()

package.preload["ffi/util"] = function()
    return { template = function(s) return s end }
end

local SelfUpdate = require("selfupdate")
local cmp = SelfUpdate.compareVersions

-- Plain versions
H.eq("equal", cmp("2026.07.0", "2026.07.0"), 0)
H.eq("older", cmp("2026.07.0", "2026.07.1"), -1)
H.eq("newer", cmp("2026.07.1", "2026.07.0"), 1)
H.eq("v prefix ignored", cmp("v1.2.3", "1.2.3"), 0)
H.eq("missing components are zero", cmp("1.2", "1.2.0"), 0)

-- Release tags carry a non-numeric prefix; the hyphen in "koplugin-v"
-- must not be mistaken for a pre-release separator (it once made every
-- release parse as 0.0.0, so updates were never detected).
H.eq("hyphenated tag prefix", cmp("2026.07.0", "koplugin-v2026.07.1"), -1)
H.eq("dotted tag prefix", cmp("2026.07.0", "koplugin.v2026.07.2"), -1)
H.eq("tag equal to installed", cmp("2026.07.1", "koplugin-v2026.07.1"), 0)

-- Pre-release/build suffixes after the digits are still stripped
H.eq("rc suffix dropped", cmp("0.2.0-rc1", "0.2.0"), 0)
H.eq("build suffix dropped", cmp("1.2.3+build5", "1.2.3"), 0)

-- Degenerate input
H.eq("nil is oldest", cmp(nil, "0.0.1"), -1)
H.eq("garbage is oldest", cmp("koplugin", "2026.07.0"), -1)

H.finish()
