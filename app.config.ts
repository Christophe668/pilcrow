import type { ExpoConfig } from "@expo/config-types";

const config: ExpoConfig = {
  name: "Pilcrow",
  slug: "pilcrow",
  scheme: "pilcrow",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: "com.cpecsteen.pilcrow",
    supportsTablet: true,
  },
  android: {
    package: "com.cpecsteen.pilcrow",
  },
  web: {
    bundler: "metro",
    output: "static",
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
