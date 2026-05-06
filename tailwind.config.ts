import type { Config } from "tailwindcss";
import { lightPalette, darkPalette } from "./src/theme/tokens.generated";

const palette = Object.fromEntries(
  Object.keys(lightPalette).map((key) => [key, `var(--color-${key})`]),
);

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: palette,
      fontFamily: {
        display: ["Newsreader", "Iowan Old Style", "Charter", "Georgia", "serif"],
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Inter",
          "Segoe UI",
          "system-ui",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SF Mono", "JetBrains Mono", "Menlo", "monospace"],
      },
    },
  },
};

export { lightPalette, darkPalette };
export default config;
