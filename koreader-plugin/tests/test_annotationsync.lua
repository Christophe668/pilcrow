local H = dofile(arg[0]:match("^(.*)/") .. "/helpers.lua")
H.setup()

local AnnotationSync = require("annotationsync")

local function fake_cache(articles)
    return {
        articles = articles,
        listIds = function(self)
            local out = {}
            for id in pairs(self.articles) do out[#out + 1] = id end
            table.sort(out)
            return out
        end,
        get = function(self, id) return self.articles[id] end,
        setFlag = function(self, id, key, value)
            if self.articles[id] then self.articles[id][key] = value end
        end,
    }
end

------------------------------------------------------------------------
-- Wallabag: annotations embedded in the entry fetch
------------------------------------------------------------------------

do
    local cache = fake_cache({
        -- covered by the embedded map: no round-trip
        ["1"] = { local_path = "/x/1.epub" },
        -- has a local file but not covered: falls back to per-article
        ["2"] = { local_path = "/x/2.epub" },
        -- embedded empty list clears a stale cached set
        ["3"] = { local_path = "/x/3.epub",
                  server_annotations = { { id = "9", quote = "old" } } },
        -- cold row: never a target
        ["4"] = {},
    })
    local fetched_ids = {}
    local client = {
        kind = "wallabag",
        listAnnotations = function(_, id)
            fetched_ids[#fetched_ids + 1] = id
            return true, { { id = 7, quote = "q7", text = "n7", created_at = "t7" } }
        end,
    }

    local counters = AnnotationSync.pullAll(cache, client, nil, {
        embedded = {
            ["1"] = { { id = 5, quote = "q5", text = "n5", created_at = "t5" } },
            ["3"] = {},
        },
    })

    H.eq("wallabag: only uncovered target round-trips", #fetched_ids, 1)
    H.eq("wallabag: uncovered target is article 2", fetched_ids[1], "2")
    H.eq("wallabag: embedded normalized quote",
         cache:get("1").server_annotations[1].quote, "q5")
    H.eq("wallabag: embedded normalized note",
         cache:get("1").server_annotations[1].note, "n5")
    H.eq("wallabag: empty embedded list clears stale set",
         #cache:get("3").server_annotations, 0)
    H.eq("wallabag: per-article result stored",
         cache:get("2").server_annotations[1].quote, "q7")
    H.eq("wallabag: articles counter", counters.articles, 3)
    H.eq("wallabag: fetched counter", counters.fetched, 2)
    H.eq("wallabag: no failures", counters.failed, 0)
end

------------------------------------------------------------------------
-- Readeck: global summary decides who pays a per-article round-trip
------------------------------------------------------------------------

do
    local cache = fake_cache({
        -- unchanged id-set: skipped, cached detail (note) preserved
        ["a"] = { local_path = "/x/a.epub",
                  server_annotations = { { id = "1", quote = "kept", note = "my note" } } },
        -- server has an extra id: refetched
        ["b"] = { local_path = "/x/b.epub",
                  server_annotations = { { id = "2" } } },
        -- vanished from the server: cleared without a round-trip
        ["c"] = { local_path = "/x/c.epub",
                  server_annotations = { { id = "3" } } },
        -- cold row: never a target
        ["d"] = {},
    })
    local fetched_ids = {}
    local client = {
        kind = "readeck",
        listAnnotations = function(_, id)
            fetched_ids[#fetched_ids + 1] = id
            return true, {
                { id = "2", text = "two", created = "t2" },
                { id = "4", text = "four", created = "t4" },
            }
        end,
        listAllAnnotations = function()
            return true, {
                { id = "1", bookmark_id = "a", text = "kept" },
                { id = "2", bookmark_id = "b", text = "two" },
                { id = "4", bookmark_id = "b", text = "four" },
            }
        end,
    }

    local steps = {}
    local counters = AnnotationSync.pullAll(cache, client, function(done, total)
        steps[#steps + 1] = { done = done, total = total }
    end)

    H.eq("readeck: only changed article round-trips", #fetched_ids, 1)
    H.eq("readeck: changed article is b", fetched_ids[1], "b")
    H.eq("readeck: unchanged article keeps cached note",
         cache:get("a").server_annotations[1].note, "my note")
    H.eq("readeck: changed article refreshed",
         #cache:get("b").server_annotations, 2)
    H.eq("readeck: vanished set cleared", #cache:get("c").server_annotations, 0)
    H.eq("readeck: articles counter", counters.articles, 3)
    H.eq("readeck: fetched counter", counters.fetched, 3)
    H.eq("readeck: progress total is per-article fetches only",
         steps[1] and steps[1].total, 1)
end

------------------------------------------------------------------------
-- Readeck: global listing failure falls back to the full sweep
------------------------------------------------------------------------

do
    local cache = fake_cache({
        ["a"] = { local_path = "/x/a.epub" },
        ["b"] = { local_path = "/x/b.epub" },
    })
    local fetched_ids = {}
    local client = {
        kind = "readeck",
        listAnnotations = function(_, id)
            fetched_ids[#fetched_ids + 1] = id
            return true, {}
        end,
        listAllAnnotations = function() return false, "HTTP 404" end,
    }

    local counters = AnnotationSync.pullAll(cache, client)

    H.eq("fallback: every target round-trips", #fetched_ids, 2)
    H.eq("fallback: articles counter", counters.articles, 2)
end

------------------------------------------------------------------------
-- Per-article failure keeps existing data
------------------------------------------------------------------------

do
    local cache = fake_cache({
        ["a"] = { local_path = "/x/a.epub",
                  server_annotations = { { id = "1", quote = "kept" } } },
    })
    local client = {
        kind = "wallabag",
        listAnnotations = function() return false, "HTTP 500" end,
    }

    local counters = AnnotationSync.pullAll(cache, client)

    H.eq("failure: counted", counters.failed, 1)
    H.eq("failure: cached data preserved",
         cache:get("a").server_annotations[1].quote, "kept")
end

H.finish()
