local H = dofile(arg[0]:match("^(.*)/") .. "/helpers.lua")
H.setup()

local KeyFile = require("keyfile")

-- extract: happy paths
H.eq("bare key", KeyFile.extract("sk-ant-api03-abcdef123456"), "sk-ant-api03-abcdef123456")
H.eq("trailing newline", KeyFile.extract("sk-ant-api03-abcdef123456\n"), "sk-ant-api03-abcdef123456")
H.eq("crlf", KeyFile.extract("sk-ant-api03-abcdef123456\r\n"), "sk-ant-api03-abcdef123456")
H.eq("surrounding spaces", KeyFile.extract("   sk-ant-api03-abcdef123456   \n"), "sk-ant-api03-abcdef123456")
H.eq("utf8 bom", KeyFile.extract("\239\187\191sk-ant-api03-abcdef123456\n"), "sk-ant-api03-abcdef123456")
H.eq("leading blank lines", KeyFile.extract("\n  \n\nsk-ant-api03-abcdef123456\n"), "sk-ant-api03-abcdef123456")
H.eq("first non-empty line wins", KeyFile.extract("sk-ant-api03-abcdef123456\nnotes about the key\n"), "sk-ant-api03-abcdef123456")

-- extract: rejections
local function reason(content)
    local key, err = KeyFile.extract(content)
    return key == nil and err or ("unexpected key: " .. tostring(key))
end
H.eq("nil content", reason(nil), "empty")
H.eq("empty string", reason(""), "empty")
H.eq("whitespace only", reason("  \n\t\n"), "empty")
H.eq("internal space", reason("my api key\n"), "not_a_key")
H.eq("too short", reason("abc\n"), "not_a_key")
H.eq("too long", reason(string.rep("a", KeyFile.MAX_KEY_CHARS + 1)), "not_a_key")
H.eq("control bytes", reason("sk-ant\1\2abcdef123456\n"), "not_a_key")
H.eq("non-ascii", reason("clé-secrète-1234\n"), "not_a_key")
H.eq("max length accepted", KeyFile.extract(string.rep("a", KeyFile.MAX_KEY_CHARS)), string.rep("a", KeyFile.MAX_KEY_CHARS))
H.eq("min length accepted", KeyFile.extract("abcd1234"), "abcd1234")

-- read: io layer
local tmp = "/tmp/pilcrow-test-keyfile.txt"
local function write_tmp(content)
    local f = assert(io.open(tmp, "wb"))
    f:write(content)
    f:close()
end

write_tmp("sk-ant-api03-abcdef123456\n")
H.eq("read happy path", KeyFile.read(tmp), "sk-ant-api03-abcdef123456")

write_tmp(string.rep("a", KeyFile.MAX_BYTES + 1))
local key, err = KeyFile.read(tmp)
H.eq("read oversized file", key == nil and err or "unexpected key", "too_large")

write_tmp("")
key, err = KeyFile.read(tmp)
H.eq("read empty file", key == nil and err or "unexpected key", "empty")

os.remove(tmp)
key, err = KeyFile.read(tmp)
H.eq("read missing file", key == nil and err or "unexpected key", "unreadable")

H.finish()
