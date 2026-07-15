local H = dofile(arg[0]:match("^(.*)/") .. "/helpers.lua")
H.setup()

local SummaryPage = require("summarypage")

------------------------------------------------------------------------
-- build_xhtml
------------------------------------------------------------------------

local article = { title = 'Ampers & <Angle> "Quote"' }
local xhtml = SummaryPage.build_xhtml(article,
    "First paragraph.\nSecond & final.", "claude-haiku-4-5")

H.check("xhtml declares xml", xhtml:find('<?xml version="1.0"', 1, true) == 1)
H.check("title escaped",
    xhtml:find('Ampers &amp; &lt;Angle&gt; &quot;Quote&quot;', 1, true) ~= nil)
H.check("first paragraph present", xhtml:find("<p>First paragraph.</p>", 1, true) ~= nil)
H.check("second paragraph escaped", xhtml:find("<p>Second &amp; final.</p>", 1, true) ~= nil)
H.check("model footer present", xhtml:find("claude-haiku-4-5", 1, true) ~= nil)

local no_model = SummaryPage.build_xhtml(article, "Body.", nil)
H.check("no model footer when model nil", no_model:find('class="model"', 1, true) == nil)
H.check("nil-safe title", SummaryPage.build_xhtml({}, "x", nil) ~= nil)

------------------------------------------------------------------------
-- find_opf_path
------------------------------------------------------------------------

local CONTAINER = [[<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>]]

H.eq("opf path found", SummaryPage.find_opf_path(CONTAINER), "OEBPS/content.opf")
H.eq("garbage container", SummaryPage.find_opf_path("<xml/>"), nil)
H.eq("nil container", SummaryPage.find_opf_path(nil), nil)

------------------------------------------------------------------------
-- patch_opf
------------------------------------------------------------------------

local OPF = [[<?xml version="1.0"?>
<package version="2.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid">
  <metadata/>
  <manifest>
    <item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>
    <item id="content" href="content.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="title"/>
    <itemref idref="content"/>
  </spine>
</package>]]

local patched, already = SummaryPage.patch_opf(OPF, SummaryPage.FILENAME)
H.check("patch returns string", type(patched) == "string")
H.eq("fresh patch not already", already, false)
H.check("manifest item added", patched:find(
    '<item id="pilcrow-summary" href="pilcrow-summary.xhtml" media-type="application/xhtml+xml"/>',
    1, true) ~= nil)
H.check("itemref is first spine entry", patched:find(
    '<spine toc="ncx">%s*<itemref idref="pilcrow%-summary"/>') ~= nil)
H.check("original itemrefs kept", patched:find('<itemref idref="title"/>', 1, true) ~= nil)

local patched2, already2 = SummaryPage.patch_opf(patched, SummaryPage.FILENAME)
H.eq("idempotent content", patched2, patched)
H.eq("idempotent flag", already2, true)

local nil1, err1 = SummaryPage.patch_opf("<package><spine></spine></package>", "x.xhtml")
H.eq("no manifest fails", nil1, nil)
H.eq("no manifest err", err1, "opf_unrecognized")

local nil2, err2 = SummaryPage.patch_opf(
    "<package><manifest></manifest><spine/></package>", "x.xhtml")
H.eq("self-closing spine fails", nil2, nil)
H.eq("self-closing spine err", err2, "opf_unrecognized")

local nil3, err3 = SummaryPage.patch_opf(nil, "x.xhtml")
H.eq("nil opf fails", nil3, nil)
H.eq("nil opf err", err3, "opf_missing")

------------------------------------------------------------------------
-- inject (stubbed archiver)
------------------------------------------------------------------------

-- Minimal in-memory double of ffi/archiver. `opts.write_fails` makes
-- Writer:addFileFromMemory fail for that entry path; `opts.reader_open_fails`
-- makes Reader:open fail.
local function stub_archiver(files, opts)
    opts = opts or {}
    local state = { written = {}, writer_opened = nil, compression = "none" }
    local Reader = {}
    Reader.__index = Reader
    function Reader.new() return setmetatable({}, Reader) end
    function Reader:open(path)
        if opts.reader_open_fails then return nil end
        self.path = path
        return true
    end
    function Reader:iterate()
        local i = 0
        return function()
            i = i + 1
            local f = files[i]
            if not f then return nil end
            return { path = f.path, mode = "file", size = #f.content, index = i }
        end
    end
    function Reader:extractToMemory(key)
        for _, f in ipairs(files) do
            if f.path == key then return f.content end
        end
        return nil
    end
    function Reader:close() end

    local Writer = {}
    Writer.__index = Writer
    function Writer.new() return setmetatable({}, Writer) end
    function Writer:open(path)
        state.writer_opened = path
        return true
    end
    function Writer:setZipCompression(method)
        state.compression = method
        return true
    end
    function Writer:addFileFromMemory(path, content)
        if opts.write_fails == path then return nil end
        state.written[#state.written + 1] =
            { path = path, content = content, compression = state.compression }
        return true
    end
    function Writer:close() end

    -- ffi/archiver constructs via `Class:new()`; mirror that shape.
    return { Reader = { new = Reader.new }, Writer = { new = Writer.new } }, state
end

local EPUB_FILES = {
    { path = "mimetype", content = "application/epub+zip" },
    { path = "META-INF/container.xml", content = CONTAINER },
    { path = "OEBPS/content.opf", content = OPF },
    { path = "OEBPS/title.xhtml", content = "<html><body>t</body></html>" },
    { path = "OEBPS/content.xhtml", content = "<html><body>c</body></html>" },
}

local function spies()
    local log = { renames = {}, removes = {} }
    return log,
        function(a, b) log.renames[#log.renames + 1] = { a, b }; return true end,
        function(p) log.removes[#log.removes + 1] = p; return true end
end

-- Happy path.
local arch, state = stub_archiver(EPUB_FILES)
local log, rename, remove = spies()
local ok = SummaryPage.inject("/x/book.epub", "<html>SUMMARY</html>",
    { archiver = arch, rename = rename, remove = remove })
H.eq("inject succeeds", ok, true)
H.eq("writes to tmp", state.writer_opened, "/x/book.epub.pilcrow-tmp")
H.eq("mimetype first", state.written[1].path, "mimetype")
H.eq("mimetype stored", state.written[1].compression, "store")
H.eq("rest deflated", state.written[2].compression, "deflate")

local by_path = {}
for _, w in ipairs(state.written) do by_path[w.path] = w.content end
H.check("opf rewritten with itemref",
    by_path["OEBPS/content.opf"]:find("pilcrow%-summary") ~= nil)
H.eq("summary page written next to opf",
    by_path["OEBPS/pilcrow-summary.xhtml"], "<html>SUMMARY</html>")
H.check("content copied", by_path["OEBPS/content.xhtml"] ~= nil)
H.eq("renamed over original", log.renames[1][1], "/x/book.epub.pilcrow-tmp")
H.eq("renamed to epub", log.renames[1][2], "/x/book.epub")
H.eq("no removes on success", #log.removes, 0)

-- Re-inject over an already-injected epub: refreshes the page, no dupes.
local injected_opf = select(1, SummaryPage.patch_opf(OPF, SummaryPage.FILENAME))
local REINJECT_FILES = {
    { path = "mimetype", content = "application/epub+zip" },
    { path = "META-INF/container.xml", content = CONTAINER },
    { path = "OEBPS/content.opf", content = injected_opf },
    { path = "OEBPS/pilcrow-summary.xhtml", content = "<html>OLD</html>" },
    { path = "OEBPS/content.xhtml", content = "<html><body>c</body></html>" },
}
local arch2, state2 = stub_archiver(REINJECT_FILES)
local log2, rename2, remove2 = spies()
H.eq("re-inject succeeds", SummaryPage.inject("/x/book.epub", "<html>NEW</html>",
    { archiver = arch2, rename = rename2, remove = remove2 }), true)
local seen = 0
local new_content
for _, w in ipairs(state2.written) do
    if w.path == "OEBPS/pilcrow-summary.xhtml" then
        seen = seen + 1
        new_content = w.content
    end
end
H.eq("summary written exactly once", seen, 1)
H.eq("summary refreshed", new_content, "<html>NEW</html>")

-- Write failure: original untouched, tmp cleaned up.
local arch3 = select(1, stub_archiver(EPUB_FILES, { write_fails = "OEBPS/content.xhtml" }))
local log3, rename3, remove3 = spies()
local nok, nerr = SummaryPage.inject("/x/book.epub", "<html>S</html>",
    { archiver = arch3, rename = rename3, remove = remove3 })
H.eq("write failure returns nil", nok, nil)
H.eq("write failure err", nerr, "write_failed")
H.eq("no rename on failure", #log3.renames, 0)
H.eq("tmp removed on failure", log3.removes[1], "/x/book.epub.pilcrow-tmp")

-- Reader can't open the epub.
local arch4 = select(1, stub_archiver(EPUB_FILES, { reader_open_fails = true }))
local nok4, nerr4 = SummaryPage.inject("/x/book.epub", "s", { archiver = arch4 })
H.eq("open failure returns nil", nok4, nil)
H.eq("open failure err", nerr4, "epub_open_failed")

-- Unrecognized OPF: nothing written, nothing renamed.
local BAD_OPF_FILES = {
    { path = "mimetype", content = "application/epub+zip" },
    { path = "META-INF/container.xml", content = CONTAINER },
    { path = "OEBPS/content.opf", content = "<package><spine/></package>" },
}
local arch5 = select(1, stub_archiver(BAD_OPF_FILES))
local log5, rename5, remove5 = spies()
local nok5, nerr5 = SummaryPage.inject("/x/book.epub", "s",
    { archiver = arch5, rename = rename5, remove = remove5 })
H.eq("bad opf returns nil", nok5, nil)
H.eq("bad opf err", nerr5, "opf_unrecognized")
H.eq("bad opf: no rename", #log5.renames, 0)

-- No archiver available.
local nok6, nerr6 = SummaryPage.inject("/x/book.epub", "s", {})
H.eq("missing archiver returns nil", nok6, nil)
H.eq("missing archiver err", nerr6, "no_archiver")

H.finish()
