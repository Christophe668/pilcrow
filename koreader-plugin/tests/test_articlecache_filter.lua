local H = dofile(arg[0]:match("^(.*)/") .. "/helpers.lua")
H.setup()

local Cache = require("articlecache")

local cache = Cache.open("wallabag")
cache.data.articles = {}  -- ignore any leftover state from a previous run

local function add(id, opts)
    cache:upsertFromApi({
        id = id, title = "Article " .. id, url = "https://x/" .. id,
        reading_time = 3, created_at = "2026-07-0" .. id .. "T00:00:00Z",
        is_archived = (opts and opts.archived) and 1 or 0,
        is_starred = 0,
    })
end

local function ids(list)
    local out = {}
    for _, a in ipairs(list) do out[#out + 1] = a.id end
    table.sort(out)
    return table.concat(out, ",")
end

add(1)                     -- unread
add(2)                     -- unread, then marked read locally below
add(3, { archived = true })

-- Simulate an offline mark-as-read (`_markFinished` without network):
-- only `finished` is set; `is_archived` stays false until the next
-- successful sync pushes the flag to the server.
cache:setFlag(2, "finished", true)

H.eq("unread list excludes locally-read article",
     ids(cache:list({ status = "unread" })), "1")
H.eq("archived list includes locally-read article",
     ids(cache:list({ status = "archived" })), "2,3")
H.eq("all list keeps everything", ids(cache:list({ status = "all" })), "1,2,3")

H.eq("unread count excludes locally-read article", cache:count("unread"), 1)
H.eq("archived count includes locally-read article", cache:count("archived"), 2)

H.eq("isRead: plain unread article", Cache.isRead(cache:get(1)), false)
H.eq("isRead: locally-read (unsynced) article", Cache.isRead(cache:get(2)), true)
H.eq("isRead: server-archived article", Cache.isRead(cache:get(3)), true)

-- Mark-as-unread / clear-progress resets the flag: back into Unread.
cache:setFlag(2, "finished", false)
H.eq("cleared article returns to unread",
     ids(cache:list({ status = "unread" })), "1,2")

H.finish()
