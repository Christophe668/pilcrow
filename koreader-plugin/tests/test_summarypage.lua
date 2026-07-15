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

H.finish()
