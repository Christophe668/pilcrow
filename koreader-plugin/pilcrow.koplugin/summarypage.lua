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

return SummaryPage
