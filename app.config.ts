import type { ExpoConfig } from "@expo/config-types";

const config: ExpoConfig = {
  name: "wallabag",
  slug: "wallabag",
  scheme: "wallabag",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: "com.cpecsteen.wallabag",
    supportsTablet: true,
  },
  android: {
    package: "com.cpecsteen.wallabag",
  },
  web: {
    bundler: "metro",
    output: "static",
  },
  plugins: ["expo-router", "expo-font", "expo-secure-store"],
  experiments: {
    typedRoutes: true,
  },
};

export default config;
