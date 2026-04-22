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

/**
 * Resolved palette for the current theme. Use this when a value needs to be
 * passed to a non-Tailwind consumer (e.g. icon `color` props that don't read
 * CSS variables). Return type matches `lightPalette` so consumers get the
 * full set of named tokens with non-nullable strings.
 */
export type Tokens = typeof lightPalette;

export function useTokens(): Tokens {
  const { resolved } = useTheme();
  return useMemo(() => paletteFor(resolved) as Tokens, [resolved]);
}
