--[[--
Summary-as-first-page EPUB rewriting for Pilcrow.

Pure logic for turning a cached LLM summary into a page inside the
article's EPUB: build the XHTML, patch the OPF (manifest entry + first
spine slot), and rewrite the zip through KOReader's `ffi/archiver`.
No UI here, and no policy: main.lua decides *when* injection is safe
(never once the document has a sidecar — crengine anchors highlights
and last positions by DocFragment index, and an inserted page would
shift every anchor).

@module pilcrow.summarypage
--]]

local logger = require("logger")

local SummaryPage = {}

SummaryPage.FILENAME = "pilcrow-summary.xhtml"
SummaryPage.ITEM_ID  = "pilcrow-summary"

local ESCAPES = {
    ["&"] = "&amp;", ["<"] = "&lt;", [">"] = "&gt;",
    ['"'] = "&quot;", ["'"] = "&apos;",
}

local function xml_escape(s)
    return (tostring(s or ""):gsub('[&<>"\']', ESCAPES))
end

--- Render the summary page. `summary` is plain text (paragraphs
--  separated by newlines); `model` is an optional attribution line.
function SummaryPage.build_xhtml(article, summary, model)
    local paragraphs = {}
    for para in tostring(summary or ""):gmatch("[^\n]+") do
        local trimmed = para:gsub("^%s+", ""):gsub("%s+$", "")
        if trimmed ~= "" then
            paragraphs[#paragraphs + 1] = "  <p>" .. xml_escape(trimmed) .. "</p>"
        end
    end
    local footer = ""
    if model and model ~= "" then
        footer = '  <p class="model">— ' .. xml_escape(model) .. "</p>\n"
    end
    return table.concat({
        '<?xml version="1.0" encoding="utf-8"?>',
        '<html xmlns="http://www.w3.org/1999/xhtml">',
        "<head>",
        "  <title>Summary</title>",
        "  <style>",
        "    body { margin: 1em; }",
        "    h1 { font-size: 1.2em; margin-bottom: 0.2em; }",
        "    .label { font-variant: small-caps; margin-top: 0; }",
        "    .model { font-size: 0.8em; margin-top: 2em; }",
        "  </style>",
        "</head>",
        "<body>",
        "  <h1>" .. xml_escape(article and article.title or "") .. "</h1>",
        '  <p class="label">Summary</p>',
        table.concat(paragraphs, "\n"),
        footer .. "</body>",
        "</html>",
    }, "\n")
end

--- Path of the package document, per META-INF/container.xml.
function SummaryPage.find_opf_path(container_xml)
    if type(container_xml) ~= "string" then return nil end
    return container_xml:match('<rootfile[^>]-full%-path="([^"]+)"')
end

--- Insert the summary page into an OPF document.
--  Success: returns `patched, already` — `already = true` means a
--  previous injection is present and the OPF was returned unchanged
--  (the caller still rewrites the XHTML entry, so a regenerated
--  summary refreshes the page). Failure: `nil, err`; callers must
--  leave the EPUB untouched.
function SummaryPage.patch_opf(opf, href)
    if type(opf) ~= "string" then return nil, "opf_missing" end
    if opf:find(SummaryPage.ITEM_ID, 1, true) then
        return opf, true
    end
    local item = string.format(
        '<item id="%s" href="%s" media-type="application/xhtml+xml"/>',
        SummaryPage.ITEM_ID, href)
    local itemref = string.format('<itemref idref="%s"/>', SummaryPage.ITEM_ID)

    local patched, n = opf:gsub("</manifest>", item .. "\n  </manifest>", 1)
    if n ~= 1 then return nil, "opf_unrecognized" end
    -- First spine slot: right after the <spine …> opening tag. A
    -- self-closing <spine/> carries no itemrefs at all — treat it as
    -- unrecognized rather than guess at the document's intent.
    local spine_open = patched:match("<spine[^>]*>")
    if not spine_open or spine_open:sub(-2) == "/>" then
        return nil, "opf_unrecognized"
    end
    patched, n = patched:gsub("(<spine[^>]*>)", "%1\n    " .. itemref, 1)
    if n ~= 1 then return nil, "opf_unrecognized" end
    return patched, false
end

--- Rewrite `epub_path` with the summary page as the first spine item.
--  Streams one entry at a time (peak memory = largest single file),
--  writes to a sibling tmp file, and renames over the original only
--  on success — the original EPUB is never modified in place.
--  `deps.archiver` is KOReader's `ffi/archiver` (or a test double);
--  `deps.rename` / `deps.remove` default to `os.rename` / `os.remove`.
--  @return true  |  nil, err
function SummaryPage.inject(epub_path, xhtml, deps)
    local archiver = deps and deps.archiver
    if not archiver then return nil, "no_archiver" end
    local rename = (deps and deps.rename) or os.rename
    local remove = (deps and deps.remove) or os.remove

    local reader = archiver.Reader:new()
    if not reader:open(epub_path) then
        return nil, "epub_open_failed"
    end

    -- Pass 1: enumerate entries, pull container.xml, locate + patch the OPF.
    local order = {}
    for entry in reader:iterate() do
        if entry.mode == "file" then order[#order + 1] = entry.path end
    end
    local container = reader:extractToMemory("META-INF/container.xml")
    local opf_path = SummaryPage.find_opf_path(container)
    if not opf_path then
        reader:close()
        return nil, "no_opf"
    end
    local opf_dir = opf_path:match("^(.*)/[^/]+$")
    local summary_path = (opf_dir and (opf_dir .. "/") or "") .. SummaryPage.FILENAME
    local patched, already_or_err = SummaryPage.patch_opf(
        reader:extractToMemory(opf_path), SummaryPage.FILENAME)
    if not patched then
        reader:close()
        return nil, already_or_err
    end

    -- Pass 2: write the replacement zip. `mimetype` must be the first
    -- entry and stored uncompressed (EPUB/OCF requirement); a stale
    -- summary page from a previous injection is skipped so the fresh
    -- XHTML below is the only copy.
    local tmp_path = epub_path .. ".pilcrow-tmp"
    local writer = archiver.Writer:new()
    if not writer:open(tmp_path, "epub") then
        reader:close()
        return nil, "tmp_open_failed"
    end
    local mtime = os.time()
    local function fail(err)
        writer:close()
        reader:close()
        remove(tmp_path)
        return nil, err
    end
    if not writer:setZipCompression("store")
       or not writer:addFileFromMemory("mimetype", "application/epub+zip", mtime)
       or not writer:setZipCompression("deflate") then
        return fail("write_failed")
    end
    for _, path in ipairs(order) do
        if path ~= "mimetype" and path ~= summary_path then
            local content
            if path == opf_path then
                content = patched
            else
                content = reader:extractToMemory(path)
            end
            if not content then return fail("read_failed") end
            if not writer:addFileFromMemory(path, content, mtime) then
                return fail("write_failed")
            end
        end
    end
    if not writer:addFileFromMemory(summary_path, xhtml, mtime) then
        return fail("write_failed")
    end
    writer:close()
    reader:close()

    local ok = rename(tmp_path, epub_path)
    if not ok then
        remove(tmp_path)
        return nil, "rename_failed"
    end
    logger.dbg("pilcrow/summary: injected summary page into", epub_path)
    return true
end

return SummaryPage
