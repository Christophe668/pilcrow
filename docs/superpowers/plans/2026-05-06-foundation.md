# Foundation Implementation Plan (Phase 1 of 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A bootable Expo app (iOS / Android / web) where the user can complete the two-step Wallabag onboarding wizard, the app obtains and refreshes OAuth2 tokens, and the user can sign out. No article features yet — that arrives in later phases.

**Architecture:** Expo prebuild project, TypeScript, Expo Router file-based routes, NativeWind theming driven by oklch-to-hex precomputed tokens, OAuth2 password grant with proactive + reactive token refresh, SecureStore for tokens / AsyncStorage for non-secrets. Every layer is unit-tested with Vitest; UI layer is smoke-tested with React Native Testing Library + msw.

**Tech Stack:** pnpm, Expo SDK 50+, TypeScript, Expo Router, NativeWind 4, TanStack Query, React Hook Form + Zod, Vitest, msw, React Native Testing Library, eslint, prettier.

**Reference spec:** `docs/superpowers/specs/2026-05-06-wallabag-expo-client-design.md` (sections 2, 3, 5, 10).

---

## File map for this plan

```
wallabag/
├── app/
│   ├── _layout.tsx                  # Root: theme provider, query client, auth gate
│   ├── +not-found.tsx
│   ├── (auth)/
│   │   ├── _layout.tsx              # Auth stack header
│   │   ├── server.tsx               # Step 1: server URL
│   │   └── credentials.tsx          # Step 2: OAuth credentials
│   └── (app)/
│       ├── _layout.tsx              # Authenticated stack
│       ├── index.tsx                # Placeholder home
│       └── settings.tsx             # Sign out only for this phase
├── src/
│   ├── api/
│   │   ├── client.ts                # fetch wrapper with auto-refresh
│   │   ├── info.ts                  # GET /api/info.json
│   │   └── types.ts                 # API response types
│   ├── auth/
│   │   ├── oauth.ts                 # password grant + refresh grant calls
│   │   ├── storage.ts               # SecureStore wrappers
│   │   └── tokens.ts                # in-memory token state + refresh state machine
│   ├── hooks/
│   │   └── useAuth.ts               # subscribe to auth state from React
│   ├── lib/
│   │   ├── async-storage.ts         # typed wrappers
│   │   └── url.ts                   # normalizeServerUrl, parseServerUrl
│   ├── theme/
│   │   ├── tokens.input.ts          # oklch source values (hand-written)
│   │   ├── tokens.generated.ts      # hex output (script-generated, committed)
│   │   ├── provider.tsx             # ThemeProvider + useTheme
│   │   └── fonts.ts                 # font loading
│   └── test/
│       ├── setup.ts                 # vitest setup
│       └── msw-server.ts            # msw test server
├── scripts/
│   └── oklch-to-hex.ts              # palette generator (run via pnpm script)
├── tests/
│   ├── unit/                        # Vitest unit tests
│   └── ui/                          # RNTL component tests
├── app.config.ts
├── babel.config.js
├── eas.json
├── eslint.config.mjs
├── metro.config.js
├── tailwind.config.ts
├── tsconfig.json
├── vitest.config.ts
├── package.json
├── pnpm-workspace.yaml              # not used yet but prepares future pnpm patches
├── .gitignore
├── .prettierrc.json
└── .env.example
```

---

## Task 1: Project bootstrap

**Files:**
- Create: `package.json`, `tsconfig.json`, `app.config.ts`, `babel.config.js`, `metro.config.js`, `.gitignore`, `.env.example`, `app/_layout.tsx`, `app/+not-found.tsx`, `app/index.tsx`

- [ ] **Step 1: Initialize Expo project with TypeScript template**

Run from repo root:

```bash
pnpm create expo-app@latest tmp-init -t expo-template-blank-typescript --no-install
cp -R tmp-init/. .
rm -rf tmp-init
pnpm install expo@latest expo-router@latest expo-font@latest expo-status-bar@latest expo-system-ui@latest expo-secure-store@latest @react-native-async-storage/async-storage@latest react-native-reanimated@latest react-native-safe-area-context@latest react-native-screens@latest react-native-gesture-handler@latest react@latest react-native@latest
pnpm install -D typescript@latest @types/react@latest
```

- [ ] **Step 2: Configure Expo Router + typed routes in `app.config.ts`**

Replace `app.json` with `app.config.ts`:

```ts
import { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "wallabag",
  slug: "wallabag",
  scheme: "wallabag",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
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
  plugins: [
    "expo-router",
    "expo-font",
    "expo-secure-store",
  ],
  experiments: {
    typedRoutes: true,
  },
};

export default config;
```

Delete the old `app.json` if present.

- [ ] **Step 3: Set entrypoint to expo-router/entry in `package.json`**

Edit `package.json`:

```json
{
  "main": "expo-router/entry",
  "scripts": {
    "start": "expo start",
    "ios": "expo start --ios",
    "android": "expo start --android",
    "web": "expo start --web"
  }
}
```

- [ ] **Step 4: Add a root layout and a placeholder home**

Create `app/_layout.tsx`:

```tsx
import { Stack } from "expo-router";

export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

Create `app/index.tsx`:

```tsx
import { Text, View } from "react-native";

export default function Home() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <Text>wallabag</Text>
    </View>
  );
}
```

Create `app/+not-found.tsx`:

```tsx
import { Link, Stack } from "expo-router";
import { Text, View } from "react-native";

export default function NotFound() {
  return (
    <>
      <Stack.Screen options={{ title: "Not found" }} />
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <Text>Page not found.</Text>
        <Link href="/">Go home</Link>
      </View>
    </>
  );
}
```

- [ ] **Step 5: Boot the web target to confirm setup**

Run: `pnpm web`
Expected: browser opens, a centred "wallabag" text appears, no console errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: bootstrap Expo + Expo Router project"
```

---

## Task 2: Lint, format, typecheck

**Files:**
- Create: `eslint.config.mjs`, `.prettierrc.json`, `.gitignore`, `tsconfig.json` updates

- [ ] **Step 1: Install dev tooling**

```bash
pnpm add -D eslint@latest @eslint/js@latest typescript-eslint@latest eslint-config-expo@latest eslint-plugin-react-hooks@latest prettier@latest eslint-plugin-prettier@latest eslint-config-prettier@latest
```

- [ ] **Step 2: Add `eslint.config.mjs`**

```js
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import expoConfig from "eslint-config-expo/flat.js";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-plugin-prettier/recommended";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...expoConfig,
  reactHooks.configs["recommended-latest"],
  prettier,
  {
    ignores: ["node_modules/", "ios/", "android/", ".expo/", "dist/", "tests/coverage/"],
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "react-hooks/exhaustive-deps": "warn",
    },
  },
);
```

- [ ] **Step 3: Add `.prettierrc.json`**

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

- [ ] **Step 4: Tighten `tsconfig.json`**

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "moduleResolution": "bundler",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["**/*.ts", "**/*.tsx", "expo-env.d.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 5: Add `.gitignore`**

```
node_modules/
.expo/
dist/
web-build/
ios/
android/
*.log
.env
.env.local
coverage/
.DS_Store
```

(`ios/` and `android/` will be re-added when we prebuild in a later phase; for now they are excluded.)

- [ ] **Step 6: Add scripts to `package.json`**

```json
{
  "scripts": {
    "start": "expo start",
    "ios": "expo start --ios",
    "android": "expo start --android",
    "web": "expo start --web",
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "typecheck": "tsc -p . --noEmit"
  }
}
```

- [ ] **Step 7: Verify all three pass**

```bash
pnpm lint && pnpm typecheck && pnpm format:check
```

Expected: all pass with no errors.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: configure eslint, prettier, strict tsconfig"
```

---

## Task 3: Vitest test runner

**Files:**
- Create: `vitest.config.ts`, `src/test/setup.ts`, `src/test/msw-server.ts`, `tests/unit/.gitkeep`

- [ ] **Step 1: Install Vitest + RNTL + msw**

```bash
pnpm add -D vitest@latest @vitest/coverage-v8@latest jsdom@latest @testing-library/react-native@latest @testing-library/jest-native@latest react-test-renderer@latest msw@latest @types/node@latest
```

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.d.ts", "src/test/**", "src/theme/tokens.generated.ts"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

- [ ] **Step 3: Create `src/test/setup.ts`**

```ts
import "@testing-library/jest-native/extend-expect";
import { server } from "./msw-server";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

- [ ] **Step 4: Create `src/test/msw-server.ts`**

```ts
import { setupServer } from "msw/node";

export const server = setupServer();
```

- [ ] **Step 5: Add a smoke test**

Create `tests/unit/smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("vitest", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Add the test script**

In `package.json`:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```

- [ ] **Step 7: Run tests**

Run: `pnpm test`
Expected: 1 passed.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: add Vitest, RNTL, msw"
```

---

## Task 4: Theme tokens — `oklch-to-hex` script

**Files:**
- Create: `scripts/oklch-to-hex.ts`, `src/theme/tokens.input.ts`, `src/theme/tokens.generated.ts`, `tests/unit/oklch.test.ts`

- [ ] **Step 1: Write a failing test for the conversion script**

Create `tests/unit/oklch.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { oklchToHex } from "../../scripts/oklch-to-hex";

describe("oklchToHex", () => {
  it("converts a known oklch triple to its hex equivalent (white)", () => {
    expect(oklchToHex(1, 0, 0)).toBe("#ffffff");
  });

  it("converts a known oklch triple to its hex equivalent (black)", () => {
    expect(oklchToHex(0, 0, 0)).toBe("#000000");
  });

  it("clamps values outside the sRGB gamut", () => {
    // Pure-saturation oklch outside sRGB should still produce a valid hex.
    const hex = oklchToHex(0.7, 0.3, 30);
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  });
});
```

- [ ] **Step 2: Run it to confirm failure**

Run: `pnpm test`
Expected: FAIL — `oklchToHex` not exported.

- [ ] **Step 3: Implement `scripts/oklch-to-hex.ts`**

```ts
// Convert oklch(L, C, H) to a sRGB hex string.
// L: 0..1, C: 0..0.4, H: degrees.
// References: https://drafts.csswg.org/css-color-4/#color-conversion-code
export function oklchToHex(l: number, c: number, h: number): string {
  const hRad = (h * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;

  const lc = l_ ** 3;
  const mc = m_ ** 3;
  const sc = s_ ** 3;

  let r = +4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc;
  let g = -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc;
  let bl = -0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc;

  // linear sRGB → gamma sRGB
  const toSrgb = (v: number) =>
    v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  r = toSrgb(r);
  g = toSrgb(g);
  bl = toSrgb(bl);

  // clamp + quantize
  const q = (v: number) =>
    Math.round(Math.min(Math.max(v, 0), 1) * 255)
      .toString(16)
      .padStart(2, "0");

  return `#${q(r)}${q(g)}${q(bl)}`;
}

// Source token definitions; mirrors the CSS in wallabag-prototype.html.
type OklchTriple = readonly [number, number, number];

const LIGHT: Record<string, OklchTriple> = {
  bg: [0.98, 0.006, 70],
  surface: [1, 0, 0],
  "surface-2": [0.965, 0.008, 70],
  fg: [0.2, 0.018, 60],
  muted: [0.46, 0.014, 60],
  subtle: [0.62, 0.012, 60],
  border: [0.91, 0.01, 70],
  "border-strong": [0.82, 0.012, 70],
  accent: [0.53, 0.19, 30],
  "accent-ink": [0.38, 0.18, 30],
  "accent-soft": [0.945, 0.035, 30],
  teal: [0.56, 0.09, 175],
  highlight: [0.91, 0.1, 85],
};

const DARK: Record<string, OklchTriple> = {
  bg: [0.16, 0.014, 60],
  surface: [0.2, 0.014, 60],
  "surface-2": [0.23, 0.014, 60],
  fg: [0.95, 0.006, 70],
  muted: [0.7, 0.012, 60],
  subtle: [0.55, 0.012, 60],
  border: [0.28, 0.014, 60],
  "border-strong": [0.38, 0.016, 60],
  accent: [0.7, 0.17, 32],
  "accent-ink": [0.82, 0.12, 32],
  "accent-soft": [0.28, 0.08, 30],
  teal: [0.72, 0.1, 175],
  highlight: [0.45, 0.1, 85],
};

function emit(palette: Record<string, OklchTriple>) {
  const entries = Object.entries(palette).map(
    ([name, [l, c, h]]) => `  "${name}": "${oklchToHex(l, c, h)}",`,
  );
  return `{\n${entries.join("\n")}\n}`;
}

export function generate(): string {
  return [
    "// AUTO-GENERATED by scripts/oklch-to-hex.ts. Do not edit by hand.",
    "// Run: pnpm tokens",
    "export const lightPalette = " + emit(LIGHT) + " as const;",
    "export const darkPalette = " + emit(DARK) + " as const;",
    "export type ThemeColor = keyof typeof lightPalette;",
    "",
  ].join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const out = path.resolve("src/theme/tokens.generated.ts");
  await fs.writeFile(out, generate(), "utf8");
  console.log("Wrote", out);
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm test tests/unit/oklch.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Add the `tokens` script**

In `package.json`:

```json
{
  "scripts": {
    "tokens": "tsx scripts/oklch-to-hex.ts"
  }
}
```

```bash
pnpm add -D tsx@latest
```

- [ ] **Step 6: Generate the tokens file**

Run: `pnpm tokens`
Expected: writes `src/theme/tokens.generated.ts` containing `lightPalette` and `darkPalette` objects with `#rrggbb` strings.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(theme): oklch-to-hex script + generated palette tokens"
```

---

## Task 5: Tailwind / NativeWind configuration

**Files:**
- Create: `tailwind.config.ts`, `global.css`, `metro.config.js`, `babel.config.js`
- Modify: `app/_layout.tsx`, `app.config.ts`

- [ ] **Step 1: Install NativeWind**

```bash
pnpm add nativewind@^4 react-native-reanimated@latest
pnpm add -D tailwindcss@^3.4 @types/tailwindcss@latest
```

- [ ] **Step 2: Create `tailwind.config.ts`**

```ts
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

// Re-export the raw palettes so the runtime ThemeProvider can switch CSS variables.
export { lightPalette, darkPalette };
export default config;
```

- [ ] **Step 3: Create `global.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 4: Configure `metro.config.js`**

```js
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);
module.exports = withNativeWind(config, { input: "./global.css" });
```

- [ ] **Step 5: Configure `babel.config.js`**

```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { jsxImportSource: "nativewind" }], "nativewind/babel"],
  };
};
```

- [ ] **Step 6: Import the stylesheet from the root layout**

Edit `app/_layout.tsx`:

```tsx
import "../global.css";
import { Stack } from "expo-router";

export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

- [ ] **Step 7: Smoke test by replacing the placeholder home with NativeWind classes**

Edit `app/index.tsx`:

```tsx
import { Text, View } from "react-native";

export default function Home() {
  return (
    <View className="flex-1 items-center justify-center bg-bg">
      <Text className="text-fg font-display text-3xl">wallabag</Text>
    </View>
  );
}
```

- [ ] **Step 8: Verify on web**

Run: `pnpm web`
Expected: page renders with the prototype's warm cream background and serifed wordmark. (Newsreader is added next task; system serif is used until then.)

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(theme): NativeWind 4 with token-driven Tailwind config"
```

---

## Task 6: Theme provider with light / dark / sepia / auto

**Files:**
- Create: `src/theme/provider.tsx`, `tests/unit/theme-provider.test.tsx`
- Modify: `app/_layout.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/theme-provider.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { describe, it, expect } from "vitest";
import { ThemeProvider, useTheme } from "@/theme/provider";

function Probe() {
  const { mode, resolved } = useTheme();
  return <Text testID="probe">{`${mode}:${resolved}`}</Text>;
}

describe("ThemeProvider", () => {
  it("defaults to auto mode", () => {
    render(
      <ThemeProvider initialMode="auto" systemScheme="light">
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("probe").props.children).toBe("auto:light");
  });

  it("explicit dark overrides system light", () => {
    render(
      <ThemeProvider initialMode="dark" systemScheme="light">
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("probe").props.children).toBe("dark:dark");
  });

  it("sepia is its own resolved value", () => {
    render(
      <ThemeProvider initialMode="sepia" systemScheme="dark">
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("probe").props.children).toBe("sepia:sepia");
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm test tests/unit/theme-provider.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the provider**

Create `src/theme/provider.tsx`:

```tsx
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { vars } from "nativewind";
import { View } from "react-native";
import { lightPalette, darkPalette } from "./tokens.generated";

export type ThemeMode = "auto" | "light" | "dark" | "sepia";
export type ResolvedMode = "light" | "dark" | "sepia";

type ThemeContextValue = {
  mode: ThemeMode;
  resolved: ResolvedMode;
  setMode: (m: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const SEPIA_OVERRIDES: Partial<Record<keyof typeof lightPalette, string>> = {
  // Sepia inherits light, with a paper-tinted background and slightly warmer fg.
  bg: "#f4ecd8",
  "surface-2": "#ece2c8",
  surface: "#fbf6e8",
  fg: "#2b1d12",
  muted: "#604a30",
  subtle: "#7d6a4f",
  border: "#dfd1ad",
  "border-strong": "#c8b78a",
};

function paletteFor(resolved: ResolvedMode) {
  if (resolved === "dark") return darkPalette;
  if (resolved === "sepia") return { ...lightPalette, ...SEPIA_OVERRIDES };
  return lightPalette;
}

function resolve(mode: ThemeMode, systemScheme: "light" | "dark"): ResolvedMode {
  if (mode === "auto") return systemScheme;
  return mode;
}

function paletteToVars(palette: Record<string, string>) {
  return Object.fromEntries(Object.entries(palette).map(([k, v]) => [`--color-${k}`, v]));
}

export function ThemeProvider({
  children,
  initialMode = "auto",
  systemScheme = "light",
}: {
  children: ReactNode;
  initialMode?: ThemeMode;
  systemScheme?: "light" | "dark";
}) {
  const [mode, setMode] = useState<ThemeMode>(initialMode);
  const resolved = resolve(mode, systemScheme);
  const cssVars = useMemo(() => vars(paletteToVars(paletteFor(resolved))), [resolved]);

  const value = useMemo<ThemeContextValue>(() => ({ mode, resolved, setMode }), [mode, resolved]);

  return (
    <ThemeContext.Provider value={value}>
      <View style={cssVars} className="flex-1">
        {children}
      </View>
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm test tests/unit/theme-provider.test.tsx`
Expected: 3 passed.

- [ ] **Step 5: Wire the provider into the root layout**

Edit `app/_layout.tsx`:

```tsx
import "../global.css";
import { Stack } from "expo-router";
import { useColorScheme } from "react-native";
import { ThemeProvider } from "@/theme/provider";

export default function RootLayout() {
  const systemScheme = useColorScheme() ?? "light";
  return (
    <ThemeProvider initialMode="auto" systemScheme={systemScheme}>
      <Stack screenOptions={{ headerShown: false }} />
    </ThemeProvider>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(theme): theme provider with auto/light/dark/sepia modes"
```

---

## Task 7: Newsreader font loading

**Files:**
- Create: `src/theme/fonts.ts`
- Add: `assets/fonts/Newsreader.ttf` (variable font)
- Modify: `app/_layout.tsx`, `app.config.ts`

- [ ] **Step 1: Download the Newsreader variable font**

```bash
mkdir -p assets/fonts
curl -fsSL "https://github.com/google/fonts/raw/main/ofl/newsreader/Newsreader%5Bopsz%2Cwght%5D.ttf" -o assets/fonts/Newsreader.ttf
curl -fsSL "https://github.com/google/fonts/raw/main/ofl/newsreader/Newsreader-Italic%5Bopsz%2Cwght%5D.ttf" -o assets/fonts/Newsreader-Italic.ttf
```

- [ ] **Step 2: Configure expo-font in `app.config.ts`**

Add to the `plugins` array:

```ts
[
  "expo-font",
  {
    fonts: [
      "./assets/fonts/Newsreader.ttf",
      "./assets/fonts/Newsreader-Italic.ttf",
    ],
  },
],
```

- [ ] **Step 3: Create `src/theme/fonts.ts`**

```ts
import { useFonts } from "expo-font";

export function useAppFonts() {
  const [loaded, error] = useFonts({
    Newsreader: require("../../assets/fonts/Newsreader.ttf"),
    "Newsreader-Italic": require("../../assets/fonts/Newsreader-Italic.ttf"),
  });
  return { loaded, error };
}
```

- [ ] **Step 4: Gate the layout on font loading**

Edit `app/_layout.tsx`:

```tsx
import "../global.css";
import { Stack } from "expo-router";
import { useColorScheme } from "react-native";
import { ThemeProvider } from "@/theme/provider";
import { useAppFonts } from "@/theme/fonts";

export default function RootLayout() {
  const systemScheme = useColorScheme() ?? "light";
  const { loaded, error } = useAppFonts();
  if (!loaded && !error) return null;
  return (
    <ThemeProvider initialMode="auto" systemScheme={systemScheme}>
      <Stack screenOptions={{ headerShown: false }} />
    </ThemeProvider>
  );
}
```

- [ ] **Step 5: Verify on web**

Run: `pnpm web`
Expected: wordmark renders in Newsreader.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(theme): bundle Newsreader variable font"
```

---

## Task 8: AsyncStorage typed wrapper

**Files:**
- Create: `src/lib/async-storage.ts`, `tests/unit/async-storage.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/async-storage.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { kvGet, kvSet, kvRemove } from "@/lib/async-storage";

const mem = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (k: string) => mem.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => void mem.set(k, v)),
    removeItem: vi.fn(async (k: string) => void mem.delete(k)),
  },
}));

beforeEach(() => mem.clear());

describe("async-storage wrapper", () => {
  it("returns null when key absent", async () => {
    expect(await kvGet("server_url")).toBeNull();
  });

  it("round-trips strings", async () => {
    await kvSet("server_url", "https://example.com");
    expect(await kvGet("server_url")).toBe("https://example.com");
  });

  it("removes a key", async () => {
    await kvSet("server_url", "https://example.com");
    await kvRemove("server_url");
    expect(await kvGet("server_url")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm test tests/unit/async-storage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the wrapper**

Create `src/lib/async-storage.ts`:

```ts
import AsyncStorage from "@react-native-async-storage/async-storage";

// Whitelist of keys: any non-secret config goes here.
export type AsyncKey = "server_url" | "last_user_id" | "theme_mode";

export async function kvGet(key: AsyncKey): Promise<string | null> {
  return AsyncStorage.getItem(`wb:${key}`);
}

export async function kvSet(key: AsyncKey, value: string): Promise<void> {
  await AsyncStorage.setItem(`wb:${key}`, value);
}

export async function kvRemove(key: AsyncKey): Promise<void> {
  await AsyncStorage.removeItem(`wb:${key}`);
}

export async function kvClear(): Promise<void> {
  for (const k of ["server_url", "last_user_id", "theme_mode"] as const) {
    await kvRemove(k);
  }
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm test tests/unit/async-storage.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(lib): typed AsyncStorage wrapper"
```

---

## Task 9: SecureStore typed wrapper

**Files:**
- Create: `src/auth/storage.ts`, `tests/unit/auth-storage.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/auth-storage.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { secureGet, secureSet, secureClear } from "@/auth/storage";

const mem = new Map<string, string>();
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (k: string) => mem.get(k) ?? null),
  setItemAsync: vi.fn(async (k: string, v: string) => void mem.set(k, v)),
  deleteItemAsync: vi.fn(async (k: string) => void mem.delete(k)),
}));

beforeEach(() => mem.clear());

describe("auth/storage", () => {
  it("returns null when missing", async () => {
    expect(await secureGet("access_token")).toBeNull();
  });

  it("round-trips a token", async () => {
    await secureSet("access_token", "abc");
    expect(await secureGet("access_token")).toBe("abc");
  });

  it("clears all keys", async () => {
    await secureSet("access_token", "a");
    await secureSet("refresh_token", "b");
    await secureSet("client_id", "c");
    await secureSet("client_secret", "d");
    await secureSet("username", "e");
    await secureSet("token_expires_at", "1");
    await secureClear();
    expect(await secureGet("access_token")).toBeNull();
    expect(await secureGet("refresh_token")).toBeNull();
    expect(await secureGet("client_id")).toBeNull();
    expect(await secureGet("client_secret")).toBeNull();
    expect(await secureGet("username")).toBeNull();
    expect(await secureGet("token_expires_at")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm test tests/unit/auth-storage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the wrapper**

Create `src/auth/storage.ts`:

```ts
import * as SecureStore from "expo-secure-store";

export type SecureKey =
  | "client_id"
  | "client_secret"
  | "username"
  | "access_token"
  | "refresh_token"
  | "token_expires_at";

const ALL_KEYS: readonly SecureKey[] = [
  "client_id",
  "client_secret",
  "username",
  "access_token",
  "refresh_token",
  "token_expires_at",
];

export async function secureGet(key: SecureKey): Promise<string | null> {
  return SecureStore.getItemAsync(`wb_${key}`);
}

export async function secureSet(key: SecureKey, value: string): Promise<void> {
  await SecureStore.setItemAsync(`wb_${key}`, value);
}

export async function secureRemove(key: SecureKey): Promise<void> {
  await SecureStore.deleteItemAsync(`wb_${key}`);
}

export async function secureClear(): Promise<void> {
  for (const k of ALL_KEYS) await secureRemove(k);
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm test tests/unit/auth-storage.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(auth): typed SecureStore wrapper for token material"
```

---

## Task 10: URL utilities

**Files:**
- Create: `src/lib/url.ts`, `tests/unit/url.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/url.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeServerUrl, isLikelyServerUrl } from "@/lib/url";

describe("normalizeServerUrl", () => {
  it("adds https:// when missing", () => {
    expect(normalizeServerUrl("app.wallabag.it")).toBe("https://app.wallabag.it");
  });
  it("strips trailing slash", () => {
    expect(normalizeServerUrl("https://app.wallabag.it/")).toBe("https://app.wallabag.it");
  });
  it("preserves http:// when explicit", () => {
    expect(normalizeServerUrl("http://localhost:8000")).toBe("http://localhost:8000");
  });
  it("preserves a path prefix (sub-pathed installs)", () => {
    expect(normalizeServerUrl("https://example.com/wallabag/")).toBe(
      "https://example.com/wallabag",
    );
  });
  it("rejects empty input", () => {
    expect(() => normalizeServerUrl("   ")).toThrow();
  });
  it("rejects non-URL strings", () => {
    expect(() => normalizeServerUrl("not a url")).toThrow();
  });
});

describe("isLikelyServerUrl", () => {
  it("accepts a normalizable string", () => {
    expect(isLikelyServerUrl("app.wallabag.it")).toBe(true);
  });
  it("rejects empty input", () => {
    expect(isLikelyServerUrl("")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm test tests/unit/url.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/lib/url.ts`:

```ts
export function normalizeServerUrl(input: string): string {
  const raw = input.trim();
  if (raw.length === 0) throw new Error("Server URL is required");
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error("Not a valid URL");
  }
  if (!url.hostname || !/\./.test(url.hostname) && url.hostname !== "localhost") {
    throw new Error("Not a valid host");
  }
  // Drop trailing slash on the path (but keep a non-empty path).
  let pathname = url.pathname.replace(/\/+$/, "");
  return `${url.protocol}//${url.host}${pathname}`;
}

export function isLikelyServerUrl(input: string): boolean {
  try {
    normalizeServerUrl(input);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm test tests/unit/url.test.ts`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(lib): server URL normalization helpers"
```

---

## Task 11: OAuth grant calls (password + refresh)

**Files:**
- Create: `src/auth/oauth.ts`, `src/api/types.ts`, `tests/unit/oauth.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/oauth.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../src/test/msw-server";
import { passwordGrant, refreshGrant } from "@/auth/oauth";

describe("passwordGrant", () => {
  it("posts grant_type=password and returns the token bundle", async () => {
    server.use(
      http.post("https://wb.test/oauth/v2/token", async ({ request }) => {
        const body = Object.fromEntries((await request.formData()).entries());
        expect(body).toEqual({
          grant_type: "password",
          client_id: "cid",
          client_secret: "cs",
          username: "u",
          password: "p",
        });
        return HttpResponse.json({
          access_token: "at",
          refresh_token: "rt",
          expires_in: 3600,
          token_type: "bearer",
        });
      }),
    );
    const r = await passwordGrant({
      serverUrl: "https://wb.test",
      clientId: "cid",
      clientSecret: "cs",
      username: "u",
      password: "p",
    });
    expect(r.access_token).toBe("at");
    expect(r.refresh_token).toBe("rt");
    expect(r.expires_in).toBe(3600);
  });

  it("throws InvalidCredentials on 400 invalid_grant", async () => {
    server.use(
      http.post("https://wb.test/oauth/v2/token", () =>
        HttpResponse.json({ error: "invalid_grant" }, { status: 400 }),
      ),
    );
    await expect(
      passwordGrant({
        serverUrl: "https://wb.test",
        clientId: "cid",
        clientSecret: "cs",
        username: "u",
        password: "p",
      }),
    ).rejects.toThrow(/credentials/i);
  });
});

describe("refreshGrant", () => {
  it("posts grant_type=refresh_token and returns the new bundle", async () => {
    server.use(
      http.post("https://wb.test/oauth/v2/token", async ({ request }) => {
        const body = Object.fromEntries((await request.formData()).entries());
        expect(body.grant_type).toBe("refresh_token");
        expect(body.refresh_token).toBe("rt-old");
        return HttpResponse.json({
          access_token: "at-new",
          refresh_token: "rt-new",
          expires_in: 3600,
          token_type: "bearer",
        });
      }),
    );
    const r = await refreshGrant({
      serverUrl: "https://wb.test",
      clientId: "cid",
      clientSecret: "cs",
      refreshToken: "rt-old",
    });
    expect(r.access_token).toBe("at-new");
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm test tests/unit/oauth.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/api/types.ts`:

```ts
export type TokenBundle = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: "bearer";
};

export type WallabagInfo = {
  appname: "wallabag";
  version: string;
  allowed_registration?: boolean;
};
```

Create `src/auth/oauth.ts`:

```ts
import type { TokenBundle } from "@/api/types";

export class InvalidCredentialsError extends Error {
  constructor() {
    super("Invalid credentials");
    this.name = "InvalidCredentialsError";
  }
}

export class OAuthError extends Error {
  constructor(
    public status: number,
    public code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "OAuthError";
  }
}

async function tokenRequest(
  serverUrl: string,
  body: Record<string, string>,
): Promise<TokenBundle> {
  const url = `${serverUrl}/oauth/v2/token`;
  const form = new URLSearchParams(body);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  if (!res.ok) {
    let code: string | undefined;
    try {
      const j = await res.json();
      code = typeof j?.error === "string" ? j.error : undefined;
    } catch {
      // ignore
    }
    if (res.status === 400 && code === "invalid_grant") {
      throw new InvalidCredentialsError();
    }
    throw new OAuthError(res.status, code, `Token endpoint returned ${res.status}`);
  }
  return (await res.json()) as TokenBundle;
}

export async function passwordGrant(args: {
  serverUrl: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
}): Promise<TokenBundle> {
  return tokenRequest(args.serverUrl, {
    grant_type: "password",
    client_id: args.clientId,
    client_secret: args.clientSecret,
    username: args.username,
    password: args.password,
  });
}

export async function refreshGrant(args: {
  serverUrl: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<TokenBundle> {
  return tokenRequest(args.serverUrl, {
    grant_type: "refresh_token",
    client_id: args.clientId,
    client_secret: args.clientSecret,
    refresh_token: args.refreshToken,
  });
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm test tests/unit/oauth.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(auth): OAuth2 password + refresh grant calls"
```

---

## Task 12: Token state machine + refresh serialization

**Files:**
- Create: `src/auth/tokens.ts`, `tests/unit/tokens.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/tokens.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

const secure = new Map<string, string>();
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (k: string) => secure.get(k) ?? null),
  setItemAsync: vi.fn(async (k: string, v: string) => void secure.set(k, v)),
  deleteItemAsync: vi.fn(async (k: string) => void secure.delete(k)),
}));

const refreshSpy = vi.fn();
vi.mock("@/auth/oauth", async () => {
  const actual = await vi.importActual<typeof import("@/auth/oauth")>("@/auth/oauth");
  return {
    ...actual,
    refreshGrant: vi.fn(async (args) => {
      refreshSpy(args);
      return {
        access_token: "at-new",
        refresh_token: "rt-new",
        expires_in: 3600,
        token_type: "bearer" as const,
      };
    }),
  };
});

import { ensureFreshToken, applyTokenBundle, getAccessToken, clearTokens } from "@/auth/tokens";

beforeEach(async () => {
  secure.clear();
  refreshSpy.mockClear();
});

describe("token state machine", () => {
  it("returns the access token when not near expiry", async () => {
    await applyTokenBundle({
      access_token: "at-1",
      refresh_token: "rt-1",
      expires_in: 3600,
      token_type: "bearer",
    });
    const before = await getAccessToken();
    expect(before).toBe("at-1");
    const after = await ensureFreshToken({
      serverUrl: "https://wb.test",
      clientId: "cid",
      clientSecret: "cs",
    });
    expect(after).toBe("at-1");
    expect(refreshSpy).not.toHaveBeenCalled();
  });

  it("refreshes when expiry within 60s", async () => {
    secure.set("wb_access_token", "at-old");
    secure.set("wb_refresh_token", "rt-old");
    secure.set("wb_token_expires_at", String(Date.now() + 30_000));
    const after = await ensureFreshToken({
      serverUrl: "https://wb.test",
      clientId: "cid",
      clientSecret: "cs",
    });
    expect(after).toBe("at-new");
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent refreshes into a single request", async () => {
    secure.set("wb_access_token", "at-old");
    secure.set("wb_refresh_token", "rt-old");
    secure.set("wb_token_expires_at", String(Date.now() - 1));
    const calls = await Promise.all(
      Array.from({ length: 5 }, () =>
        ensureFreshToken({ serverUrl: "https://wb.test", clientId: "cid", clientSecret: "cs" }),
      ),
    );
    expect(new Set(calls)).toEqual(new Set(["at-new"]));
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });

  it("clears persistent token state", async () => {
    await applyTokenBundle({
      access_token: "at",
      refresh_token: "rt",
      expires_in: 3600,
      token_type: "bearer",
    });
    await clearTokens();
    expect(await getAccessToken()).toBeNull();
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm test tests/unit/tokens.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/auth/tokens.ts`:

```ts
import { secureGet, secureSet, secureClear } from "@/auth/storage";
import { refreshGrant } from "@/auth/oauth";
import type { TokenBundle } from "@/api/types";

const REFRESH_LEEWAY_MS = 60_000;
let inFlightRefresh: Promise<string> | null = null;

export async function applyTokenBundle(bundle: TokenBundle): Promise<void> {
  const expiresAt = Date.now() + bundle.expires_in * 1000;
  await secureSet("access_token", bundle.access_token);
  await secureSet("refresh_token", bundle.refresh_token);
  await secureSet("token_expires_at", String(expiresAt));
}

export async function getAccessToken(): Promise<string | null> {
  return secureGet("access_token");
}

export async function clearTokens(): Promise<void> {
  await secureClear();
}

async function readExpiresAt(): Promise<number | null> {
  const v = await secureGet("token_expires_at");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function ensureFreshToken(args: {
  serverUrl: string;
  clientId: string;
  clientSecret: string;
}): Promise<string> {
  const access = await getAccessToken();
  const expiresAt = await readExpiresAt();
  const needsRefresh =
    !access || expiresAt === null || expiresAt - Date.now() < REFRESH_LEEWAY_MS;
  if (!needsRefresh) return access!;

  if (!inFlightRefresh) {
    inFlightRefresh = (async () => {
      try {
        const refresh = await secureGet("refresh_token");
        if (!refresh) throw new Error("Missing refresh_token");
        const bundle = await refreshGrant({
          serverUrl: args.serverUrl,
          clientId: args.clientId,
          clientSecret: args.clientSecret,
          refreshToken: refresh,
        });
        await applyTokenBundle(bundle);
        return bundle.access_token;
      } finally {
        inFlightRefresh = null;
      }
    })();
  }
  return inFlightRefresh;
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm test tests/unit/tokens.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(auth): token state machine with serialized refresh"
```

---

## Task 13: API client wrapper with auto-refresh

**Files:**
- Create: `src/api/client.ts`, `src/api/info.ts`, `tests/unit/api-client.test.ts`, `tests/unit/api-info.test.ts`

- [ ] **Step 1: Write the failing test for the client**

Create `tests/unit/api-client.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../src/test/msw-server";

const secure = new Map<string, string>();
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (k: string) => secure.get(k) ?? null),
  setItemAsync: vi.fn(async (k: string, v: string) => void secure.set(k, v)),
  deleteItemAsync: vi.fn(async (k: string) => void secure.delete(k)),
}));

import { request } from "@/api/client";
import { applyTokenBundle } from "@/auth/tokens";

beforeEach(async () => {
  secure.clear();
  secure.set("wb_client_id", "cid");
  secure.set("wb_client_secret", "cs");
  await applyTokenBundle({
    access_token: "at-1",
    refresh_token: "rt-1",
    expires_in: 3600,
    token_type: "bearer",
  });
});

describe("api request()", () => {
  it("attaches the bearer token", async () => {
    server.use(
      http.get("https://wb.test/api/info.json", ({ request }) => {
        expect(request.headers.get("authorization")).toBe("Bearer at-1");
        return HttpResponse.json({ appname: "wallabag", version: "2.6.9" });
      }),
    );
    const r = await request<{ appname: string }>({
      serverUrl: "https://wb.test",
      method: "GET",
      path: "/api/info.json",
    });
    expect(r.appname).toBe("wallabag");
  });

  it("retries once on 401 after refresh", async () => {
    let calls = 0;
    server.use(
      http.post("https://wb.test/oauth/v2/token", () =>
        HttpResponse.json({
          access_token: "at-2",
          refresh_token: "rt-2",
          expires_in: 3600,
          token_type: "bearer",
        }),
      ),
      http.get("https://wb.test/api/info.json", ({ request }) => {
        calls += 1;
        const auth = request.headers.get("authorization");
        if (auth === "Bearer at-1") {
          return HttpResponse.json({ error: "invalid_grant" }, { status: 401 });
        }
        return HttpResponse.json({ appname: "wallabag", version: "2.6.9" });
      }),
    );
    const r = await request<{ appname: string }>({
      serverUrl: "https://wb.test",
      method: "GET",
      path: "/api/info.json",
    });
    expect(r.appname).toBe("wallabag");
    expect(calls).toBe(2);
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm test tests/unit/api-client.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/api/client.ts`**

```ts
import { secureGet } from "@/auth/storage";
import { ensureFreshToken } from "@/auth/tokens";

export type RequestArgs = {
  serverUrl: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public path: string,
    public bodyText: string,
  ) {
    super(`API ${status} ${path}`);
    this.name = "ApiError";
  }
}

async function readClientCreds() {
  const clientId = await secureGet("client_id");
  const clientSecret = await secureGet("client_secret");
  if (!clientId || !clientSecret) {
    throw new Error("Client credentials missing — re-authenticate");
  }
  return { clientId, clientSecret };
}

function buildUrl(serverUrl: string, path: string, query?: RequestArgs["query"]) {
  const url = new URL(serverUrl + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function send(args: RequestArgs, token: string): Promise<Response> {
  return fetch(buildUrl(args.serverUrl, args.path, args.query), {
    method: args.method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(args.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: args.body !== undefined ? JSON.stringify(args.body) : undefined,
  });
}

export async function request<T>(args: RequestArgs): Promise<T> {
  const { clientId, clientSecret } = await readClientCreds();
  let token = await ensureFreshToken({
    serverUrl: args.serverUrl,
    clientId,
    clientSecret,
  });
  let res = await send(args, token);
  if (res.status === 401) {
    // Force refresh by clearing in-memory expiry; ensureFreshToken sees stale and refreshes.
    // We achieve this by setting stored expiry to "now" and calling ensure again.
    const { secureSet } = await import("@/auth/storage");
    await secureSet("token_expires_at", "0");
    token = await ensureFreshToken({
      serverUrl: args.serverUrl,
      clientId,
      clientSecret,
    });
    res = await send(args, token);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(res.status, args.path, text);
  }
  return (await res.json()) as T;
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm test tests/unit/api-client.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Write the failing test for `info`**

Create `tests/unit/api-info.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../src/test/msw-server";

const secure = new Map<string, string>();
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (k: string) => secure.get(k) ?? null),
  setItemAsync: vi.fn(async (k: string, v: string) => void secure.set(k, v)),
  deleteItemAsync: vi.fn(async (k: string) => void secure.delete(k)),
}));

import { fetchInfo } from "@/api/info";

beforeEach(() => {
  secure.clear();
});

describe("fetchInfo", () => {
  it("hits /api/info.json without auth", async () => {
    server.use(
      http.get("https://wb.test/api/info.json", ({ request }) => {
        expect(request.headers.get("authorization")).toBeNull();
        return HttpResponse.json({ appname: "wallabag", version: "2.6.9" });
      }),
    );
    const r = await fetchInfo("https://wb.test");
    expect(r.appname).toBe("wallabag");
  });

  it("rejects when appname is not wallabag", async () => {
    server.use(
      http.get("https://wb.test/api/info.json", () =>
        HttpResponse.json({ appname: "something-else", version: "1.0" }),
      ),
    );
    await expect(fetchInfo("https://wb.test")).rejects.toThrow(/not a wallabag/i);
  });
});
```

- [ ] **Step 6: Run it**

Run: `pnpm test tests/unit/api-info.test.ts`
Expected: FAIL.

- [ ] **Step 7: Implement `src/api/info.ts`**

```ts
import type { WallabagInfo } from "@/api/types";

export async function fetchInfo(serverUrl: string): Promise<WallabagInfo> {
  const res = await fetch(`${serverUrl}/api/info.json`);
  if (!res.ok) {
    throw new Error(`Server returned ${res.status} for /api/info.json`);
  }
  const j = (await res.json()) as Partial<WallabagInfo>;
  if (j.appname !== "wallabag") {
    throw new Error("This is not a wallabag instance");
  }
  return j as WallabagInfo;
}
```

- [ ] **Step 8: Run the test**

Run: `pnpm test tests/unit/api-info.test.ts`
Expected: 2 passed.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(api): authed request() wrapper + info.json check"
```

---

## Task 14: useAuth hook and auth state events

**Files:**
- Create: `src/auth/state.ts`, `src/hooks/useAuth.ts`, `tests/unit/auth-state.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/auth-state.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

const secure = new Map<string, string>();
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (k: string) => secure.get(k) ?? null),
  setItemAsync: vi.fn(async (k: string, v: string) => void secure.set(k, v)),
  deleteItemAsync: vi.fn(async (k: string) => void secure.delete(k)),
}));

import { authStore, hydrateAuth, signIn, signOut } from "@/auth/state";

beforeEach(async () => {
  secure.clear();
  authStore.set({ status: "unknown", serverUrl: null });
});

describe("auth state", () => {
  it("hydrates to unauthenticated when no tokens present", async () => {
    await hydrateAuth();
    expect(authStore.get().status).toBe("unauthenticated");
  });

  it("signIn writes tokens and transitions to authenticated", async () => {
    await signIn({
      serverUrl: "https://wb.test",
      clientId: "cid",
      clientSecret: "cs",
      username: "u",
      bundle: { access_token: "at", refresh_token: "rt", expires_in: 3600, token_type: "bearer" },
    });
    expect(authStore.get().status).toBe("authenticated");
    expect(authStore.get().serverUrl).toBe("https://wb.test");
    expect(secure.get("wb_client_id")).toBe("cid");
    expect(secure.get("wb_username")).toBe("u");
  });

  it("signOut wipes all secure + async storage and transitions", async () => {
    await signIn({
      serverUrl: "https://wb.test",
      clientId: "cid",
      clientSecret: "cs",
      username: "u",
      bundle: { access_token: "at", refresh_token: "rt", expires_in: 3600, token_type: "bearer" },
    });
    await signOut();
    expect(authStore.get().status).toBe("unauthenticated");
    expect(secure.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm test tests/unit/auth-state.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/auth/state.ts`**

```ts
import { kvSet, kvGet, kvClear } from "@/lib/async-storage";
import { secureSet, secureGet, secureClear } from "@/auth/storage";
import { applyTokenBundle, clearTokens } from "@/auth/tokens";
import type { TokenBundle } from "@/api/types";

export type AuthState =
  | { status: "unknown"; serverUrl: null }
  | { status: "unauthenticated"; serverUrl: string | null }
  | { status: "authenticated"; serverUrl: string };

type Listener = (state: AuthState) => void;

class Store {
  private state: AuthState = { status: "unknown", serverUrl: null };
  private listeners = new Set<Listener>();

  get(): AuthState {
    return this.state;
  }
  set(next: AuthState) {
    this.state = next;
    for (const l of this.listeners) l(next);
  }
  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

export const authStore = new Store();

export async function hydrateAuth(): Promise<void> {
  const serverUrl = await kvGet("server_url");
  const access = await secureGet("access_token");
  if (access && serverUrl) {
    authStore.set({ status: "authenticated", serverUrl });
  } else {
    authStore.set({ status: "unauthenticated", serverUrl });
  }
}

export async function signIn(args: {
  serverUrl: string;
  clientId: string;
  clientSecret: string;
  username: string;
  bundle: TokenBundle;
}): Promise<void> {
  await kvSet("server_url", args.serverUrl);
  await secureSet("client_id", args.clientId);
  await secureSet("client_secret", args.clientSecret);
  await secureSet("username", args.username);
  await applyTokenBundle(args.bundle);
  authStore.set({ status: "authenticated", serverUrl: args.serverUrl });
}

export async function signOut(): Promise<void> {
  await clearTokens(); // wipes SecureStore via secureClear
  await kvClear();
  authStore.set({ status: "unauthenticated", serverUrl: null });
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm test tests/unit/auth-state.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Implement the hook**

Create `src/hooks/useAuth.ts`:

```ts
import { useSyncExternalStore } from "react";
import { authStore, type AuthState } from "@/auth/state";

export function useAuth(): AuthState {
  return useSyncExternalStore(
    (cb) => authStore.subscribe(cb),
    () => authStore.get(),
    () => authStore.get(),
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(auth): observable auth state + signIn/signOut + hydrate"
```

---

## Task 15: Auth gate in root layout

**Files:**
- Modify: `app/_layout.tsx`
- Create: `app/(auth)/_layout.tsx`, `app/(app)/_layout.tsx`

- [ ] **Step 1: Add a TanStack QueryClient**

```bash
pnpm add @tanstack/react-query@latest
```

- [ ] **Step 2: Hydrate auth on launch and gate the router**

Replace `app/_layout.tsx`:

```tsx
import "../global.css";
import { useEffect, useState } from "react";
import { Slot, useRouter, useSegments } from "expo-router";
import { useColorScheme, View } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/theme/provider";
import { useAppFonts } from "@/theme/fonts";
import { hydrateAuth } from "@/auth/state";
import { useAuth } from "@/hooks/useAuth";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function AuthGate() {
  const auth = useAuth();
  const segments = useSegments();
  const router = useRouter();
  useEffect(() => {
    if (auth.status === "unknown") return;
    const inAuthGroup = segments[0] === "(auth)";
    if (auth.status === "authenticated" && inAuthGroup) {
      router.replace("/(app)");
    } else if (auth.status === "unauthenticated" && !inAuthGroup) {
      router.replace("/(auth)/server");
    }
  }, [auth.status, segments, router]);

  if (auth.status === "unknown") return <View className="flex-1 bg-bg" />;
  return <Slot />;
}

export default function RootLayout() {
  const systemScheme = useColorScheme() ?? "light";
  const { loaded, error } = useAppFonts();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    hydrateAuth().then(() => setHydrated(true));
  }, []);
  if ((!loaded && !error) || !hydrated) return null;
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider initialMode="auto" systemScheme={systemScheme}>
        <AuthGate />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
```

- [ ] **Step 3: Add the auth stack layout**

Create `app/(auth)/_layout.tsx`:

```tsx
import { Stack } from "expo-router";

export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

- [ ] **Step 4: Add the app stack layout**

Create `app/(app)/_layout.tsx`:

```tsx
import { Stack } from "expo-router";

export default function AppLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(routing): auth gate redirects between (auth) and (app)"
```

---

## Task 16: Step 1 — Server URL screen

**Files:**
- Create: `app/(auth)/server.tsx`, `tests/ui/server-screen.test.tsx`

- [ ] **Step 1: Install form deps**

```bash
pnpm add react-hook-form@latest zod@latest @hookform/resolvers@latest
```

- [ ] **Step 2: Write a failing UI test**

Create `tests/ui/server-screen.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { describe, it, expect, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../src/test/msw-server";

const router = { push: vi.fn(), replace: vi.fn() };
vi.mock("expo-router", () => ({
  useRouter: () => router,
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import ServerScreen from "../../app/(auth)/server";

describe("Server URL screen", () => {
  it("validates with /api/info.json and navigates to credentials", async () => {
    server.use(
      http.get("https://wb.test/api/info.json", () =>
        HttpResponse.json({ appname: "wallabag", version: "2.6.9" }),
      ),
    );
    render(<ServerScreen />);
    fireEvent.changeText(screen.getByPlaceholderText(/server url/i), "wb.test");
    fireEvent.press(screen.getByRole("button", { name: /continue/i }));
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith({
        pathname: "/(auth)/credentials",
        params: { serverUrl: "https://wb.test" },
      }),
    );
  });

  it("shows an error when the host is not wallabag", async () => {
    server.use(
      http.get("https://nope.test/api/info.json", () =>
        HttpResponse.json({ appname: "other", version: "1.0" }),
      ),
    );
    render(<ServerScreen />);
    fireEvent.changeText(screen.getByPlaceholderText(/server url/i), "nope.test");
    fireEvent.press(screen.getByRole("button", { name: /continue/i }));
    await waitFor(() =>
      expect(screen.getByText(/not a wallabag/i)).toBeTruthy(),
    );
  });
});
```

- [ ] **Step 3: Implement the screen**

Create `app/(auth)/server.tsx`:

```tsx
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { normalizeServerUrl } from "@/lib/url";
import { fetchInfo } from "@/api/info";

const Schema = z.object({
  serverUrl: z.string().min(1, "Server URL is required"),
});
type FormData = z.infer<typeof Schema>;

export default function ServerScreen() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useForm<FormData>({
    resolver: zodResolver(Schema),
    defaultValues: { serverUrl: "" },
  });

  const onSubmit = handleSubmit(async (data) => {
    setSubmitting(true);
    setTopError(null);
    try {
      const url = normalizeServerUrl(data.serverUrl);
      await fetchInfo(url);
      router.push({ pathname: "/(auth)/credentials", params: { serverUrl: url } });
    } catch (e) {
      setTopError(e instanceof Error ? e.message : "Could not reach the server");
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <View className="flex-1 bg-bg px-6 justify-center">
      <Text className="font-display text-fg text-4xl mb-2">wallabag</Text>
      <Text className="text-muted text-base mb-10">Connect to your server</Text>

      <Text className="text-fg text-sm mb-2">Server URL</Text>
      <Controller
        control={control}
        name="serverUrl"
        render={({ field: { value, onChange, onBlur }, fieldState }) => (
          <View>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="https://app.wallabag.it"
              placeholderTextColor="#888"
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              className="border border-border bg-surface text-fg rounded-md px-3 py-3"
            />
            {fieldState.error ? (
              <Text className="text-accent text-xs mt-1">{fieldState.error.message}</Text>
            ) : null}
          </View>
        )}
      />

      {topError ? <Text className="text-accent text-sm mt-4">{topError}</Text> : null}

      <Pressable
        accessibilityRole="button"
        disabled={submitting || formState.isSubmitting}
        onPress={onSubmit}
        className="bg-accent rounded-md py-3 mt-6 items-center"
      >
        {submitting ? (
          <ActivityIndicator />
        ) : (
          <Text className="text-white font-medium">Continue</Text>
        )}
      </Pressable>
    </View>
  );
}
```

- [ ] **Step 4: Run the UI test**

Run: `pnpm test tests/ui/server-screen.test.tsx`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(auth): step 1 — server URL screen with /api/info.json validation"
```

---

## Task 17: Step 2 — Credentials screen

**Files:**
- Create: `app/(auth)/credentials.tsx`, `tests/ui/credentials-screen.test.tsx`

- [ ] **Step 1: Write a failing UI test**

Create `tests/ui/credentials-screen.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../src/test/msw-server";

const secure = new Map<string, string>();
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (k: string) => secure.get(k) ?? null),
  setItemAsync: vi.fn(async (k: string, v: string) => void secure.set(k, v)),
  deleteItemAsync: vi.fn(async (k: string) => void secure.delete(k)),
}));
const asyncMem = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (k: string) => asyncMem.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => void asyncMem.set(k, v)),
    removeItem: vi.fn(async (k: string) => void asyncMem.delete(k)),
  },
}));

const router = { push: vi.fn(), replace: vi.fn() };
const params = { serverUrl: "https://wb.test" };
vi.mock("expo-router", () => ({
  useRouter: () => router,
  useLocalSearchParams: () => params,
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import CredentialsScreen from "../../app/(auth)/credentials";

beforeEach(() => {
  secure.clear();
  asyncMem.clear();
  router.push.mockClear();
  router.replace.mockClear();
});

describe("Credentials screen", () => {
  it("signs in and replaces to (app)", async () => {
    server.use(
      http.post("https://wb.test/oauth/v2/token", () =>
        HttpResponse.json({
          access_token: "at",
          refresh_token: "rt",
          expires_in: 3600,
          token_type: "bearer",
        }),
      ),
    );
    render(<CredentialsScreen />);
    fireEvent.changeText(screen.getByPlaceholderText(/client id/i), "cid");
    fireEvent.changeText(screen.getByPlaceholderText(/client secret/i), "cs");
    fireEvent.changeText(screen.getByPlaceholderText(/username/i), "u");
    fireEvent.changeText(screen.getByPlaceholderText(/password/i), "p");
    fireEvent.press(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/(app)"));
    expect(secure.get("wb_access_token")).toBe("at");
    expect(secure.get("wb_username")).toBe("u");
    expect(secure.has("wb_password")).toBe(false);
  });

  it("surfaces invalid_grant cleanly", async () => {
    server.use(
      http.post("https://wb.test/oauth/v2/token", () =>
        HttpResponse.json({ error: "invalid_grant" }, { status: 400 }),
      ),
    );
    render(<CredentialsScreen />);
    fireEvent.changeText(screen.getByPlaceholderText(/client id/i), "cid");
    fireEvent.changeText(screen.getByPlaceholderText(/client secret/i), "cs");
    fireEvent.changeText(screen.getByPlaceholderText(/username/i), "u");
    fireEvent.changeText(screen.getByPlaceholderText(/password/i), "wrong");
    fireEvent.press(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() =>
      expect(screen.getByText(/invalid credentials/i)).toBeTruthy(),
    );
  });
});
```

- [ ] **Step 2: Implement the screen**

Create `app/(auth)/credentials.tsx`:

```tsx
import { useState } from "react";
import { ActivityIndicator, Linking, Pressable, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { passwordGrant, InvalidCredentialsError } from "@/auth/oauth";
import { signIn } from "@/auth/state";

const Schema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
});
type FormData = z.infer<typeof Schema>;

export default function CredentialsScreen() {
  const router = useRouter();
  const { serverUrl } = useLocalSearchParams<{ serverUrl: string }>();
  const [topError, setTopError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { control, handleSubmit } = useForm<FormData>({
    resolver: zodResolver(Schema),
    defaultValues: { clientId: "", clientSecret: "", username: "", password: "" },
  });

  const onSubmit = handleSubmit(async (data) => {
    if (!serverUrl) {
      setTopError("Missing server URL — restart onboarding");
      return;
    }
    setSubmitting(true);
    setTopError(null);
    try {
      const bundle = await passwordGrant({
        serverUrl,
        clientId: data.clientId,
        clientSecret: data.clientSecret,
        username: data.username,
        password: data.password,
      });
      await signIn({
        serverUrl,
        clientId: data.clientId,
        clientSecret: data.clientSecret,
        username: data.username,
        bundle,
      });
      router.replace("/(app)");
    } catch (e) {
      if (e instanceof InvalidCredentialsError) setTopError("Invalid credentials");
      else setTopError(e instanceof Error ? e.message : "Sign-in failed");
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <View className="flex-1 bg-bg px-6 justify-center">
      <Text className="font-display text-fg text-3xl mb-1">Connect</Text>
      <Text className="text-muted text-sm mb-6">{hostOf(serverUrl)}</Text>

      <Pressable
        onPress={() =>
          serverUrl ? Linking.openURL(`${serverUrl}/developer/client/create`) : undefined
        }
      >
        <Text className="text-accent text-sm mb-6">Need a client_id and secret?</Text>
      </Pressable>

      <Field control={control} name="clientId" placeholder="Client ID" />
      <Field control={control} name="clientSecret" placeholder="Client Secret" secure />
      <Field control={control} name="username" placeholder="Username" />
      <Field control={control} name="password" placeholder="Password" secure />

      {topError ? <Text className="text-accent text-sm mt-3">{topError}</Text> : null}

      <Pressable
        accessibilityRole="button"
        disabled={submitting}
        onPress={onSubmit}
        className="bg-accent rounded-md py-3 mt-6 items-center"
      >
        {submitting ? <ActivityIndicator /> : <Text className="text-white font-medium">Sign in</Text>}
      </Pressable>
    </View>
  );
}

function hostOf(u: string | undefined): string {
  if (!u) return "";
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
}

function Field({
  control,
  name,
  placeholder,
  secure,
}: {
  control: any;
  name: keyof FormData;
  placeholder: string;
  secure?: boolean;
}) {
  return (
    <View className="mb-3">
      <Controller
        control={control}
        name={name}
        render={({ field: { value, onChange, onBlur } }) => (
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={placeholder}
            placeholderTextColor="#888"
            secureTextEntry={!!secure}
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            className="border border-border bg-surface text-fg rounded-md px-3 py-3"
          />
        )}
      />
    </View>
  );
}
```

- [ ] **Step 3: Run the UI test**

Run: `pnpm test tests/ui/credentials-screen.test.tsx`
Expected: 2 passed.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(auth): step 2 — OAuth credentials screen"
```

---

## Task 18: Authenticated home + sign-out from settings

**Files:**
- Create: `app/(app)/index.tsx`, `app/(app)/settings.tsx`

- [ ] **Step 1: Implement the placeholder home**

Replace `app/(app)/index.tsx`:

```tsx
import { Link } from "expo-router";
import { Text, View } from "react-native";
import { useAuth } from "@/hooks/useAuth";

export default function AppHome() {
  const auth = useAuth();
  const host = auth.status === "authenticated" ? new URL(auth.serverUrl).host : "";
  return (
    <View className="flex-1 bg-bg px-6 pt-16">
      <Text className="font-display text-fg text-4xl mb-2">wallabag</Text>
      <Text className="text-muted text-base mb-6">Signed in to {host}</Text>
      <Text className="text-fg text-sm mb-2">
        Library is coming in Phase 3. For now you can sign out from Settings.
      </Text>
      <Link href="/(app)/settings" className="text-accent mt-4">
        Settings →
      </Link>
    </View>
  );
}
```

- [ ] **Step 2: Implement the settings screen**

Create `app/(app)/settings.tsx`:

```tsx
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/hooks/useAuth";
import { signOut } from "@/auth/state";

export default function Settings() {
  const auth = useAuth();
  const router = useRouter();
  const onSignOut = async () => {
    await signOut();
    router.replace("/(auth)/server");
  };
  const host = auth.status === "authenticated" ? new URL(auth.serverUrl).host : "—";
  return (
    <View className="flex-1 bg-bg px-6 pt-16">
      <Text className="font-display text-fg text-3xl mb-6">Settings</Text>

      <Section title="Account">
        <Row label="Server" value={host} />
      </Section>

      <Pressable
        accessibilityRole="button"
        onPress={onSignOut}
        className="border border-border bg-surface rounded-md py-3 items-center mt-8"
      >
        <Text className="text-accent">Sign out</Text>
      </Pressable>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mb-6">
      <Text className="font-mono text-subtle uppercase text-xs tracking-widest mb-2">{title}</Text>
      <View className="border border-border bg-surface rounded-md">{children}</View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between px-4 py-3 border-b border-border last:border-0">
      <Text className="text-muted text-sm">{label}</Text>
      <Text className="text-fg text-sm">{value}</Text>
    </View>
  );
}
```

- [ ] **Step 3: Verify pnpm test still all-green**

Run: `pnpm test`
Expected: every test passes.

- [ ] **Step 4: Manual smoke test**

Run: `pnpm web`, then in the browser:

1. Confirm onboarding routes to `/(auth)/server`.
2. Type a Wallabag URL, click Continue → routes to credentials.
3. Type credentials, click Sign in → arrives at `/(app)`.
4. Click Settings → click Sign out → returns to `/(auth)/server`.

(Use a real Wallabag instance you control or spin up the official Docker image: `docker run --name wallabag -p 8000:80 wallabag/wallabag`.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(app): authenticated home + settings with sign out"
```

---

## Task 19: Wire `request()` to use the stored server URL

**Files:**
- Modify: `src/api/client.ts`, `tests/unit/api-client.test.ts`

- [ ] **Step 1: Add a stored-server-URL convenience to the client**

Add to `src/api/client.ts`:

```ts
import { kvGet } from "@/lib/async-storage";

export async function authedRequest<T>(args: Omit<RequestArgs, "serverUrl">): Promise<T> {
  const serverUrl = await kvGet("server_url");
  if (!serverUrl) throw new Error("No server URL — sign in first");
  return request<T>({ ...args, serverUrl });
}
```

- [ ] **Step 2: Add a test**

Append to `tests/unit/api-client.test.ts`:

```ts
import { authedRequest } from "@/api/client";

describe("authedRequest()", () => {
  it("reads server URL from AsyncStorage", async () => {
    const asyncMem = new Map<string, string>();
    vi.mock("@react-native-async-storage/async-storage", () => ({
      default: {
        getItem: vi.fn(async (k: string) => asyncMem.get(k) ?? null),
        setItem: vi.fn(async (k: string, v: string) => void asyncMem.set(k, v)),
        removeItem: vi.fn(async (k: string) => void asyncMem.delete(k)),
      },
    }));
    asyncMem.set("wb:server_url", "https://wb.test");
    server.use(
      http.get("https://wb.test/api/info.json", () =>
        HttpResponse.json({ appname: "wallabag", version: "2.6.9" }),
      ),
    );
    const r = await authedRequest<{ appname: string }>({
      method: "GET",
      path: "/api/info.json",
    });
    expect(r.appname).toBe("wallabag");
  });
});
```

(The `vi.mock` call above is hoisted to the top of the file by Vitest — placement is fine syntactically but verify by running the test.)

- [ ] **Step 3: Run all tests**

Run: `pnpm test`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(api): authedRequest helper uses stored server URL"
```

---

## Task 20: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Add the workflow**

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm tokens
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm format:check
      - run: pnpm test
      - run: pnpm exec expo export --platform web
```

- [ ] **Step 2: Commit and verify CI green on PR**

```bash
git add -A
git commit -m "ci: typecheck, lint, format, tests, web export"
```

If GitHub Actions reports a failure, fix the underlying issue locally and push again.

---

## Task 21: README for this phase

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write a short README**

```markdown
# wallabag — Expo client

Cross-platform Wallabag reader (iOS, Android, web), built with Expo.

## Status
Phase 1 (Foundation) complete:
- Two-step onboarding wizard (server URL + OAuth credentials)
- Token storage and auto-refresh
- Sign-in / sign-out
- Theming (light / dark / sepia / auto)

Library, reader, offline sync, and share targets arrive in later phases.

## Develop

```bash
pnpm install
pnpm tokens   # generates the palette
pnpm web      # or `pnpm ios` / `pnpm android`
pnpm test
```
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "docs: README for Phase 1"
```

---

## Self-review

**Spec coverage check (Phase-1 scope only):**

| Spec section | Covered by |
|---|---|
| §2 Tech stack — Expo, TS, Router, NativeWind, TanStack, Vitest, RHF+Zod, pnpm | Tasks 1, 2, 3, 5, 15, 17 |
| §3 Repo layout (foundation slice) | Tasks 1, 4, 5, 6, 9, 14, 15 |
| §5.1 Two-step wizard | Tasks 16, 17 |
| §5.2 Token refresh (60s leeway, single in-flight, 401 retry) | Tasks 12, 13 |
| §5.3 Sign out wipes everything | Task 14, 18 |
| §10 Theming (oklch tokens, modes, fonts) | Tasks 4, 5, 6, 7 |
| §11 Testing setup | Task 3 + every test in Tasks 4–19 |
| §12 CI minimal | Task 20 |

**Out of scope by design (later phases):** §4 SQLite repos / sync engine, §6 data layer, §7 library shell, §8 reader, §9 add-article + share extensions, §13 observability/Sentry, §14 image cache.

**Placeholder scan:** none of "TBD", "TODO" within the plan body itself.

**Type consistency:**
- `TokenBundle` defined in `src/api/types.ts` (Task 11), reused in `src/auth/tokens.ts` (Task 12) and `src/auth/state.ts` (Task 14).
- `secureGet`/`secureSet`/`secureClear` from Task 9 used in Tasks 12 and 14 with the same signatures.
- `applyTokenBundle` from Task 12 used in Task 14 with the matching signature.
- `request<T>` / `authedRequest<T>` consistent between Tasks 13 and 19.
- `signIn` argument shape from Task 14 used by Task 17.
