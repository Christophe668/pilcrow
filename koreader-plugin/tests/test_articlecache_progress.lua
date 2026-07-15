local H = dofile(arg[0]:match("^(.*)/") .. "/helpers.lua")
H.setup()

-- Configurable sidecar double. Must be installed before articlecache
-- is required (module-level `require("docsettings")`).
local sidecar = { has = false, settings = {} }
package.preload["docsettings"] = function()
    return {
        hasSidecarFile = function(_, _path) return sidecar.has end,
        open = function(_, _path)
            return {
                readSetting = function(_, key) return sidecar.settings[key] end,
            }
        end,
    }
end
-- The article's local_path must look like a real file.
package.preload["libs/libkoreader-lfs"] = function()
    return {
        attributes = function(_path, _what) return "file" end,
        mkdir = function() return true end,
        dir = function() return function() return nil end end,
    }
end

local Cache = require("articlecache")

local cache = Cache.open("wallabag")
cache.data.articles = {}

cache:upsertFromApi({
    id = 7, title = "T", url = "https://x", reading_time = 3,
    created_at = "2026-07-01T00:00:00Z", is_archived = 0, is_starred = 0,
})
cache:setFlag(7, "local_path", "/fake/article.epub")

local function in_progress_count()
    cache:invalidateProgress()
    return cache:count("in_progress")
end

-- No sidecar at all → not in progress.
sidecar.has = false
H.eq("no sidecar", in_progress_count(), 0)

-- Freshly opened, still on page 1 of 10 → not in progress.
sidecar.has = true
sidecar.settings = { percent_finished = 0.1, doc_pages = 10, summary = {} }
H.eq("page 1 of 10, no summary page", in_progress_count(), 0)

-- Page 2 of 10 → past the first real page → in progress.
sidecar.settings = { percent_finished = 0.2, doc_pages = 10, summary = {} }
H.eq("page 2 of 10, no summary page", in_progress_count(), 1)

-- With an embedded summary page, page 2 is the first *real* page.
cache:setFlag(7, "summary_in_epub", true)
sidecar.settings = { percent_finished = 0.2, doc_pages = 10, summary = {} }
H.eq("page 2 of 10, summary page", in_progress_count(), 0)

sidecar.settings = { percent_finished = 0.3, doc_pages = 10, summary = {} }
H.eq("page 3 of 10, summary page", in_progress_count(), 1)

-- setFlag("summary_in_epub") must bust the memo (no invalidateProgress
-- call in between).
sidecar.settings = { percent_finished = 0.2, doc_pages = 10, summary = {} }
cache:invalidateProgress()
H.eq("memo warm: page 2 with summary page", cache:count("in_progress"), 0)
cache:setFlag(7, "summary_in_epub", nil)
H.eq("flag change re-evaluates", cache:count("in_progress"), 1)
cache:setFlag(7, "summary_in_epub", true)

-- Finished document → never in progress.
sidecar.settings = { percent_finished = 1.0, doc_pages = 10, summary = {} }
H.eq("percent 1.0", in_progress_count(), 0)

-- Status complete → never in progress.
sidecar.settings = { percent_finished = 0.5, doc_pages = 10,
                     summary = { status = "complete" } }
H.eq("status complete", in_progress_count(), 0)

-- doc_pages missing, stats.pages fallback.
sidecar.settings = { percent_finished = 0.3, stats = { pages = 10 }, summary = {} }
H.eq("stats.pages fallback", in_progress_count(), 1)

-- Neither doc_pages nor stats → legacy rule (any progress counts).
sidecar.settings = { percent_finished = 0.05, summary = {} }
H.eq("legacy fallback", in_progress_count(), 1)

-- Archived articles are excluded before the sidecar is even read.
cache:setFlag(7, "is_archived", true)
sidecar.settings = { percent_finished = 0.5, doc_pages = 10, summary = {} }
H.eq("archived excluded", in_progress_count(), 0)

H.finish()
