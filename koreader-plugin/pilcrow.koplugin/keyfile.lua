--[[--
Parse a secret (API key / bearer token) out of a plain-text file.

Exists so long keys can be imported from a file dropped on the device
instead of typed on the e-ink keyboard. Deliberately free of KOReader
requires so it loads under stock Lua for the unit tests.

@module pilcrow.keyfile
--]]

local KeyFile = {
    MAX_BYTES     = 4096, -- read cap: anything bigger isn't a key file
    MIN_KEY_CHARS = 8,
    MAX_KEY_CHARS = 1024,
}

--- Extract the secret from file content: the first line containing
--- non-whitespace, trimmed. Returns key, or nil + "empty"/"not_a_key".
function KeyFile.extract(content)
    if type(content) ~= "string" then return nil, "empty" end
    if content:sub(1, 3) == "\239\187\191" then -- UTF-8 BOM
        content = content:sub(4)
    end
    for line in (content .. "\n"):gmatch("(.-)\n") do
        local candidate = line:match("^%s*(.-)%s*$")
        if candidate ~= "" then
            -- A key is one token of printable ASCII (no spaces, no
            -- control bytes) of plausible length.
            if #candidate < KeyFile.MIN_KEY_CHARS
               or #candidate > KeyFile.MAX_KEY_CHARS
               or candidate:find("[^\33-\126]") then
                return nil, "not_a_key"
            end
            return candidate
        end
    end
    return nil, "empty"
end

return KeyFile
