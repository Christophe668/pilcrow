--[[--
On-demand LLM article summaries for Pilcrow.

Pure logic lives here (HTML→text, prompt/request building, response
parsing, EPUB text extraction) plus one thin HTTP POST helper. All UI —
progress messages, result dialog, menu wiring — stays in main.lua.

Two provider code paths behind one interface:

  * **anthropic** — Messages API (`x-api-key` + `anthropic-version`).
  * **openai**    — any `/chat/completions`-compatible endpoint
                    (OpenAI, OpenRouter, Mistral, Groq, local Ollama…).

@module pilcrow.summarizer
--]]

local JSON = require("json")
local SummaryPage = require("summarypage")
local http = require("socket.http")
local logger = require("logger")
local ltn12 = require("ltn12")
local socket = require("socket")
local socketutil = require("socketutil")

local Summarizer = {}

-- Character budget for the article text sent to the LLM. Bounds cost
-- and latency; virtually all articles fit whole.
Summarizer.MAX_CHARS = 24000

Summarizer.ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"

local ENTITIES = {
    amp = "&", lt = "<", gt = ">", quot = '"', apos = "'",
    nbsp = " ", ["#39"] = "'", ["#160"] = " ",
}

--- Very small HTML-to-plain-text converter. Good enough as LLM input;
--  not a general-purpose renderer.
function Summarizer.html_to_text(html)
    if not html or html == "" then return "" end
    local s = html
    s = s:gsub("<[sS][cC][rR][iI][pP][tT].-</[sS][cC][rR][iI][pP][tT]>", " ")
    s = s:gsub("<[sS][tT][yY][lL][eE].-</[sS][tT][yY][lL][eE]>", " ")
    s = s:gsub("<!%-%-.-%-%->", " ")
    -- Block-level closers become newlines so paragraphs stay separated.
    s = s:gsub("<[bB][rR]%s*/?>", "\n")
    s = s:gsub("</[pP]>", "\n")
    s = s:gsub("</[hH][1-6]>", "\n")
    s = s:gsub("</[lL][iI]>", "\n")
    s = s:gsub("</[dD][iI][vV]>", "\n")
    s = s:gsub("<[^>]->", "")
    s = s:gsub("&(#?%w+);", function(e) return ENTITIES[e] or " " end)
    s = s:gsub("\r", "")
    s = s:gsub("[ \t]+", " ")
    s = s:gsub(" ?\n ?", "\n")
    s = s:gsub("\n\n+", "\n")
    s = s:gsub("^%s+", ""):gsub("%s+$", "")
    return s
end

function Summarizer.truncate(text)
    if #text <= Summarizer.MAX_CHARS then return text end
    local cut = Summarizer.MAX_CHARS
    -- Don't split a multi-byte UTF-8 sequence: back up past any
    -- continuation bytes (0x80-0xBF), then drop the now-dangling
    -- lead byte too. Losing one character at a 24k cut is harmless.
    while cut > 1 do
        local b = text:byte(cut)
        if not b or b < 0x80 or b > 0xBF then break end
        cut = cut - 1
    end
    if cut >= 1 and (text:byte(cut) or 0) >= 0xC0 then cut = cut - 1 end
    return text:sub(1, cut)
end

function Summarizer.build_prompt(article, text)
    return {
        system = "You summarize web articles. Reply with ONLY the summary:"
            .. " plain text, no markdown, no preamble, no headings."
            .. " Write 120-150 words, in the same language as the article.",
        user = string.format("Title: %s\nURL: %s\n\nArticle text:\n%s",
            article.title or "(untitled)", article.url or "", text),
    }
end

--- Build a provider-specific request. `body` stays a Lua table; the
--  HTTP layer JSON-encodes it. Returns nil + error code when the
--  config is incomplete.
function Summarizer.build_request(cfg, prompt)
    if not cfg.api_key or cfg.api_key == "" then return nil, "no_key" end
    if cfg.provider == "anthropic" then
        return {
            url = Summarizer.ANTHROPIC_URL,
            headers = {
                ["x-api-key"] = cfg.api_key,
                ["anthropic-version"] = "2023-06-01",
                ["Content-Type"] = "application/json",
            },
            body = {
                model = cfg.model,
                max_tokens = 1024,
                system = prompt.system,
                messages = { { role = "user", content = prompt.user } },
            },
        }
    elseif cfg.provider == "openai" then
        local base = (cfg.base_url or ""):gsub("/+$", "")
        if base == "" then return nil, "no_base_url" end
        return {
            url = base .. "/chat/completions",
            headers = {
                ["Authorization"] = "Bearer " .. cfg.api_key,
                ["Content-Type"] = "application/json",
            },
            body = {
                model = cfg.model,
                max_tokens = 1024,
                messages = {
                    { role = "system", content = prompt.system },
                    { role = "user", content = prompt.user },
                },
            },
        }
    end
    return nil, "unknown_provider"
end

local function trim(s)
    return (s:gsub("^%s+", ""):gsub("%s+$", ""))
end

--- Extract the summary text from a decoded provider response. Both
--  APIs return JSON error bodies on non-2xx, so error extraction
--  lives here too.
function Summarizer.parse_response(provider, decoded)
    if type(decoded) ~= "table" then return nil, "bad_response" end
    if decoded.error and decoded.error.message then
        return nil, tostring(decoded.error.message)
    end
    if provider == "anthropic" then
        local blocks = decoded.content or {}
        for i = 1, #blocks do
            local b = blocks[i]
            if b.type == "text" and b.text and b.text ~= "" then
                return trim(b.text)
            end
        end
        return nil, "empty_response"
    end
    -- openai-compatible
    local choice = decoded.choices and decoded.choices[1]
    local content = choice and choice.message and choice.message.content
    if content and content ~= "" then return trim(content) end
    return nil, "empty_response"
end

------------------------------------------------------------------------
-- Article text acquisition
--
-- Prefer the locally downloaded EPUB (it's just zipped HTML — same
-- `unzip` dependency selfupdate.lua already relies on); fall back to
-- fetching the entry content from the backend. Wifi is required for
-- the LLM call anyway, so the fallback costs nothing extra.
------------------------------------------------------------------------

local function shell_quote(s)
    return "'" .. tostring(s):gsub("'", "'\\''") .. "'"
end

function Summarizer._collect_html(dir, lfs)
    local files = {}
    local function walk(d)
        for entry in lfs.dir(d) do
            if entry ~= "." and entry ~= ".." then
                local path = d .. "/" .. entry
                if lfs.attributes(path, "mode") == "directory" then
                    walk(path)
                elseif entry:lower():match("%.x?html?$")
                   and entry:lower() ~= SummaryPage.FILENAME then
                    files[#files + 1] = path
                end
            end
        end
    end
    walk(dir)
    table.sort(files)
    return files
end

--- Unzip the EPUB into deps.tmp_dir, concatenate its HTML files
--  (sorted by path — close enough to spine order for a summary), and
--  strip to plain text. deps = { lfs, execute, tmp_dir }.
function Summarizer.extract_epub_text(epub_path, deps)
    local tmp = deps.tmp_dir
    deps.execute("rm -rf " .. shell_quote(tmp))
    if deps.execute("mkdir -p " .. shell_quote(tmp)) ~= 0 then
        return nil, "mkdir_failed"
    end
    local unzip_cmd = string.format("unzip -q -o %s -d %s",
        shell_quote(epub_path), shell_quote(tmp))
    if deps.execute(unzip_cmd) ~= 0 then
        deps.execute("rm -rf " .. shell_quote(tmp))
        return nil, "unzip_failed"
    end
    local parts = {}
    local html_files = Summarizer._collect_html(tmp, deps.lfs)
    for i = 1, #html_files do
        local fh = io.open(html_files[i], "r")
        if fh then
            parts[#parts + 1] = fh:read("*a")
            fh:close()
        end
    end
    deps.execute("rm -rf " .. shell_quote(tmp))
    if #parts == 0 then return nil, "no_html_in_epub" end
    return Summarizer.html_to_text(table.concat(parts, "\n"))
end

function Summarizer.get_article_text(article, backend, deps)
    if article.local_path
       and deps.lfs.attributes(article.local_path, "mode") == "file" then
        local text = Summarizer.extract_epub_text(article.local_path, deps)
        if text and text ~= "" then return text end
        logger.warn("pilcrow/summary: EPUB extraction failed, falling back to server")
    end
    if not backend then return nil, "no_backend" end
    local ok, html = backend:getEntryContent(article.id)
    if not ok then return nil, tostring(html) end
    local text = Summarizer.html_to_text(html or "")
    if text == "" then return nil, "empty_article" end
    return text
end

------------------------------------------------------------------------
-- HTTP + entry point
------------------------------------------------------------------------

function Summarizer._http_post(url, headers, body_string)
    headers["Content-Length"] = tostring(#body_string)
    local sink = {}
    socketutil:set_timeout(15, 120)
    logger.dbg("pilcrow/summary: POST", url)
    local code = socket.skip(1, http.request{
        method = "POST",
        url = url,
        headers = headers,
        source = ltn12.source.string(body_string),
        sink = ltn12.sink.table(sink),
    })
    socketutil:reset_timeout()
    if type(code) ~= "number" then
        -- luasocket returns a string error (DNS, TLS, refused…) here.
        return false, tostring(code or "network_error")
    end
    local content = table.concat(sink)
    local ok, decoded = pcall(JSON.decode, content)
    if not ok or decoded == nil then
        -- Both providers send JSON error bodies; a non-JSON body means
        -- something upstream (proxy, gateway) answered instead.
        return false, "HTTP " .. tostring(code)
    end
    return true, decoded
end

--- Entry point: fetch text, call the configured provider, return the
--  summary. Blocking — main.lua shows an InfoMessage around it (same
--  pattern as the refetch action).
--  @return true, summary  or  false, error_message
function Summarizer.summarize(article, backend, cfg, deps)
    local text, terr = Summarizer.get_article_text(article, backend, deps)
    if not text then return false, terr or "no_text" end
    local prompt = Summarizer.build_prompt(article, Summarizer.truncate(text))
    local req, rerr = Summarizer.build_request(cfg, prompt)
    if not req then return false, rerr end
    local ok, decoded = Summarizer._http_post(req.url, req.headers, JSON.encode(req.body))
    if not ok then return false, decoded end
    local summary, perr = Summarizer.parse_response(cfg.provider, decoded)
    if not summary then return false, perr end
    return true, summary
end

return Summarizer
