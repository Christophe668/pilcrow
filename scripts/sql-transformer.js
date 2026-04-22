const upstream = require("@expo/metro-config/babel-transformer");
const fs = require("node:fs");

module.exports.transform = function transform({ src, filename, options }) {
  if (filename.endsWith(".sql")) {
    const raw = fs.readFileSync(filename, "utf8");
    const wrapped = `module.exports = ${JSON.stringify(raw)};`;
    return upstream.transform({ src: wrapped, filename, options });
  }
  return upstream.transform({ src, filename, options });
};
