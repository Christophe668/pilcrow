import type { Config } from "tailwindcss";
import { lightPalette, darkPalette } from "./src/theme/tokens.generated";

const palette: Record<keyof typeof lightPalette, string> = Object.fromEntries(
  Object.keys(lightPalette).map((key) => [key, `var(--color-${key})`]),
) as Record<keyof typeof lightPalette, string>;

// Semantic aliases: point at the same CSS var as the brand color, so a
// palette tweak flows through automatically. Use these in component code
// when the intent is functional (`bg-danger` on a destructive button)
// rather than visual (`bg-accent` on a brand chip).
const semantic = {
  danger: palette.accent,
  "danger-ink": palette["accent-ink"],
  "danger-soft": palette["accent-soft"],
  success: palette.teal,
};

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: { ...palette, ...semantic },
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
