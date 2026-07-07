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
    -- continuation bytes (0x80-0xBF) at the cut boundary.
    while cut > 1 do
        local b = text:byte(cut)
        if not b or b < 0x80 or b > 0xBF then break end
        cut = cut - 1
    end
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

return Summarizer
