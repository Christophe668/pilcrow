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

-- build_request: anthropic
local acfg = { provider = "anthropic", api_key = "sk-ant-xxx", model = "claude-haiku-4-5" }
local req = Summarizer.build_request(acfg, prompt)
H.eq("anthropic url", req.url, "https://api.anthropic.com/v1/messages")
H.eq("anthropic key header", req.headers["x-api-key"], "sk-ant-xxx")
H.eq("anthropic version header", req.headers["anthropic-version"], "2023-06-01")
H.eq("anthropic content type", req.headers["Content-Type"], "application/json")
H.eq("anthropic model", req.body.model, "claude-haiku-4-5")
H.eq("anthropic system", req.body.system, prompt.system)
H.eq("anthropic user message", req.body.messages[1].content, prompt.user)
H.eq("anthropic role", req.body.messages[1].role, "user")
H.check("anthropic max_tokens set", type(req.body.max_tokens) == "number")

local noreq, kerr = Summarizer.build_request(
    { provider = "anthropic", api_key = "", model = "m" }, prompt)
H.check("anthropic empty key rejected", noreq == nil and kerr == "no_key", kerr)

-- build_request: openai-compatible
local ocfg = { provider = "openai", api_key = "sk-oai", model = "gpt-4o-mini",
               base_url = "https://api.openai.com/v1/" }
local oreq = Summarizer.build_request(ocfg, prompt)
H.eq("openai url joins base", oreq.url, "https://api.openai.com/v1/chat/completions")
H.eq("openai auth header", oreq.headers["Authorization"], "Bearer sk-oai")
H.eq("openai system role", oreq.body.messages[1].role, "system")
H.eq("openai user role", oreq.body.messages[2].role, "user")
H.eq("openai user content", oreq.body.messages[2].content, prompt.user)

local nob, berr = Summarizer.build_request(
    { provider = "openai", api_key = "k", model = "m", base_url = "" }, prompt)
H.check("openai empty base url rejected", nob == nil and berr == "no_base_url", berr)

-- parse_response: anthropic
local s1 = Summarizer.parse_response("anthropic",
    { content = { { type = "text", text = "  A summary.  " } } })
H.eq("anthropic success parsed", s1, "A summary.")
local s2, e2 = Summarizer.parse_response("anthropic",
    { type = "error", error = { type = "authentication_error", message = "invalid x-api-key" } })
H.check("anthropic error surfaced", s2 == nil and e2 == "invalid x-api-key", e2)
local s3, e3 = Summarizer.parse_response("anthropic", { content = {} })
H.check("anthropic empty content is error", s3 == nil and e3 ~= nil, e3)

-- parse_response: openai
local s4 = Summarizer.parse_response("openai",
    { choices = { { message = { role = "assistant", content = "Short summary." } } } })
H.eq("openai success parsed", s4, "Short summary.")
local s5, e5 = Summarizer.parse_response("openai",
    { error = { message = "model not found", type = "invalid_request_error" } })
H.check("openai error surfaced", s5 == nil and e5 == "model not found", e5)
local s6, e6 = Summarizer.parse_response("openai", { choices = {} })
H.check("openai empty choices is error", s6 == nil and e6 ~= nil, e6)

-- _collect_html: recursive + sorted, ignores non-html
local fake_fs = {
    ["/e"] = { "b.html", "sub", "cover.jpg" },
    ["/e/sub"] = { "a.xhtml", "notes.txt" },
}
local stub_lfs = {
    dir = function(d)
        local i, list = 0, fake_fs[d] or {}
        return function() i = i + 1; return list[i] end
    end,
    attributes = function(path, _what)
        return fake_fs[path] and "directory" or "file"
    end,
}
local files = Summarizer._collect_html("/e", stub_lfs)
H.eq("collect count", #files, 2)
H.eq("collect sorted 1", files[1], "/e/b.html")
H.eq("collect sorted 2", files[2], "/e/sub/a.xhtml")

-- get_article_text: server fallback when no local EPUB
local fake_backend = {}
function fake_backend:getEntryContent(id)
    return true, "<h1>T</h1><p>Hello <b>world</b>!</p>"
end
local text = Summarizer.get_article_text({ id = 7 }, fake_backend,
    { lfs = { attributes = function() return nil end } })
H.eq("server fallback text", text, "T\nHello world!")

-- get_article_text: server fetch failure surfaces error
local bad_backend = {}
function bad_backend:getEntryContent(id) return false, "http_error" end
local no_text, gerr = Summarizer.get_article_text({ id = 7 }, bad_backend,
    { lfs = { attributes = function() return nil end } })
H.check("server failure surfaces", no_text == nil and gerr == "http_error", gerr)

-- extract_epub_text: unzip failure cleaned up and reported
local calls = {}
local etext, eerr = Summarizer.extract_epub_text("/x.epub", {
    lfs = stub_lfs,
    tmp_dir = "/tmp/pilcrow-test-sum",
    execute = function(cmd)
        calls[#calls + 1] = cmd
        if cmd:find("unzip", 1, true) then return 1 end  -- fail
        return 0
    end,
})
H.check("unzip failure reported", etext == nil and eerr == "unzip_failed", eerr)

H.finish()
