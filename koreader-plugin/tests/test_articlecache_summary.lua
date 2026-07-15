local H = dofile(arg[0]:match("^(.*)/") .. "/helpers.lua")
H.setup()

local Cache = require("articlecache")

local cache = Cache.open("wallabag")
cache.data.articles = {}  -- ignore any leftover state from a previous run

local api_entry = {
    id = 42, title = "T", url = "https://x", reading_time = 3,
    created_at = "2026-07-01T00:00:00Z", is_archived = 0, is_starred = 0,
}

cache:upsertFromApi(api_entry)
cache:setFlag(42, "summary", "A cached summary.")
cache:setFlag(42, "summary_model", "claude-haiku-4-5")

-- A sync re-upserts the same entry from the API; device-only fields
-- must survive.
cache:upsertFromApi(api_entry)

local a = cache:get(42)
H.eq("summary survives sync", a.summary, "A cached summary.")
H.eq("summary_model survives sync", a.summary_model, "claude-haiku-4-5")

cache:setFlag(42, "summary_in_epub", true)
cache:upsertFromApi(api_entry)
H.eq("summary_in_epub survives sync", cache:get(42).summary_in_epub, true)

H.finish()
