import type { ExpoConfig } from "@expo/config-types";

const config: ExpoConfig = {
  name: "Pilcrow",
  slug: "pilcrow",
  scheme: "pilcrow",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  icon: "./assets/icon.png",
  ios: {
    bundleIdentifier: "com.pilcrow.app",
    supportsTablet: true,
  },
  android: {
    package: "com.pilcrow.app",
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#c1291b",
    },
  },
  web: {
    bundler: "metro",
    output: "static",
    favicon: "./assets/favicon.png",
  },
  plugins: [
    "expo-router",
    [
      "expo-font",
      {
        fonts: ["./assets/fonts/Newsreader.ttf", "./assets/fonts/Newsreader-Italic.ttf"],
      },
    ],
    "expo-secure-store",
  ],
  experiments: {
    typedRoutes: true,
  },
};

export default config;
