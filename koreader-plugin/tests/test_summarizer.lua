local H = dofile(arg[0]:match("^(.*)/") .. "/helpers.lua")
H.setup()

local Summarizer = require("summarizer")

-- html_to_text
H.eq("strips tags", Summarizer.html_to_text("<p>Hello <b>world</b></p>"), "Hello world")
H.eq("drops scripts",
    Summarizer.html_to_text("<p>A</p><script>var x = '<b>no</b>';</script><p>B</p>"),
    "A\nB")
H.eq("drops styles",
    Summarizer.html_to_text("<style>p { color: red }</style><p>Hi</p>"), "Hi")
H.eq("decodes entities",
    Summarizer.html_to_text("<p>Fish &amp; chips &lt;3</p>"), "Fish & chips <3")
H.eq("br becomes newline",
    Summarizer.html_to_text("line one<br/>line two"), "line one\nline two")
H.eq("empty input", Summarizer.html_to_text(nil), "")
H.check("paragraphs separated by newlines",
    Summarizer.html_to_text("<p>One.</p><p>Two.</p>") == "One.\nTwo.",
    Summarizer.html_to_text("<p>One.</p><p>Two.</p>"))
H.eq("drops html comments",
    Summarizer.html_to_text("<p>A</p><!-- a <b>comment</b> --><p>B</p>"),
    "A\nB")

-- truncate
H.eq("short text untouched", Summarizer.truncate("hello"), "hello")
local long = string.rep("a", Summarizer.MAX_CHARS + 500)
H.eq("long text cut to budget", #Summarizer.truncate(long), Summarizer.MAX_CHARS)
-- truncate must not split a multi-byte UTF-8 character
local multi = string.rep("é", Summarizer.MAX_CHARS)  -- 2 bytes each
local cut_multi = Summarizer.truncate(multi)
H.check("truncate <= budget", #cut_multi <= Summarizer.MAX_CHARS)
local last = cut_multi:byte(#cut_multi)
H.check("truncate ends on complete char", last < 0x80 or last > 0xBF,
    string.format("last byte 0x%02X", last))

-- build_prompt
local prompt = Summarizer.build_prompt(
    { title = "My Title", url = "https://example.com/x" }, "BODY TEXT")
H.check("system asks for article language",
    prompt.system:find("same language", 1, true) ~= nil, prompt.system)
H.check("system asks for plain text",
    prompt.system:find("plain text", 1, true) ~= nil, prompt.system)
H.check("user prompt carries title", prompt.user:find("My Title", 1, true) ~= nil)
H.check("user prompt carries body", prompt.user:find("BODY TEXT", 1, true) ~= nil)

H.finish()
