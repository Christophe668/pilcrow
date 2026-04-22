// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const { backendProxyMiddleware } = require("./scripts/dev-backend-proxy");

const config = getDefaultConfig(__dirname);
config.resolver.sourceExts.push("sql");
config.resolver.assetExts.push("wasm");
config.transformer.babelTransformerPath = require.resolve("./scripts/sql-transformer.js");

// Forward backend requests through the dev server so the web target
// isn't blocked by CORS on self-hosted Wallabag/Readeck instances.
const previousEnhanceMiddleware = config.server?.enhanceMiddleware;
config.server = {
  ...config.server,
  enhanceMiddleware: (metroMiddleware, server) => {
    const wrapped = previousEnhanceMiddleware
      ? previousEnhanceMiddleware(metroMiddleware, server)
      : metroMiddleware;
    const proxy = backendProxyMiddleware();
    return (req, res, next) => proxy(req, res, () => wrapped(req, res, next));
  },
};

module.exports = withNativeWind(config, { input: "./global.css" });
