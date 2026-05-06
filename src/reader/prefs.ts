import AsyncStorage from "@react-native-async-storage/async-storage";

export type ReaderFontSize = "S" | "M" | "L" | "XL";
export type ReaderFontFamily = "serif" | "sans";
export type ReaderTheme = "light" | "dark" | "sepia";

export type ReaderPrefs = {
  fontSize: ReaderFontSize;
  fontFamily: ReaderFontFamily;
  theme: ReaderTheme;
};

export const DEFAULT_PREFS: ReaderPrefs = {
  fontSize: "M",
  fontFamily: "serif",
  theme: "light",
};

const STORAGE_KEY = "wb:reader_prefs";
const FONT_SIZES: ReaderFontSize[] = ["S", "M", "L", "XL"];
const FONT_FAMILIES: ReaderFontFamily[] = ["serif", "sans"];
const THEMES: ReaderTheme[] = ["light", "dark", "sepia"];

function sanitize(input: unknown): ReaderPrefs {
  if (!input || typeof input !== "object") return DEFAULT_PREFS;
  const o = input as Record<string, unknown>;
  return {
    fontSize: FONT_SIZES.includes(o["fontSize"] as ReaderFontSize)
      ? (o["fontSize"] as ReaderFontSize)
      : DEFAULT_PREFS.fontSize,
    fontFamily: FONT_FAMILIES.includes(o["fontFamily"] as ReaderFontFamily)
      ? (o["fontFamily"] as ReaderFontFamily)
      : DEFAULT_PREFS.fontFamily,
    theme: THEMES.includes(o["theme"] as ReaderTheme)
      ? (o["theme"] as ReaderTheme)
      : DEFAULT_PREFS.theme,
  };
}

export async function loadReaderPrefs(): Promise<ReaderPrefs> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_PREFS;
  try {
    return sanitize(JSON.parse(raw));
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function saveReaderPrefs(prefs: ReaderPrefs): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(sanitize(prefs)));
}
