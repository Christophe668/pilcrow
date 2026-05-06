// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);
config.resolver.sourceExts.push("sql");
config.transformer.babelTransformerPath = require.resolve("./scripts/sql-transformer.js");
module.exports = withNativeWind(config, { input: "./global.css" });
