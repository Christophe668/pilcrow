import { describe, it, expect, beforeEach, vi } from "vitest";

const mem = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (k: string) => mem.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => void mem.set(k, v)),
    removeItem: vi.fn(async (k: string) => void mem.delete(k)),
  },
}));

import { loadReaderPrefs, saveReaderPrefs, DEFAULT_PREFS } from "@/reader/prefs";

beforeEach(() => mem.clear());

describe("reader prefs", () => {
  it("loadReaderPrefs returns defaults when nothing stored", async () => {
    expect(await loadReaderPrefs()).toEqual(DEFAULT_PREFS);
  });

  it("save + load round-trips", async () => {
    await saveReaderPrefs({ fontSize: "L", fontFamily: "sans", theme: "dark" });
    expect(await loadReaderPrefs()).toEqual({
      fontSize: "L",
      fontFamily: "sans",
      theme: "dark",
    });
  });

  it("loadReaderPrefs falls back to defaults on malformed JSON", async () => {
    mem.set("wb:reader_prefs", "not json");
    expect(await loadReaderPrefs()).toEqual(DEFAULT_PREFS);
  });

  it("loadReaderPrefs ignores unknown values", async () => {
    mem.set(
      "wb:reader_prefs",
      JSON.stringify({ fontSize: "BOGUS", fontFamily: "sans", theme: "dark" }),
    );
    const r = await loadReaderPrefs();
    expect(r.fontSize).toBe("M");
    expect(r.fontFamily).toBe("sans");
    expect(r.theme).toBe("dark");
  });
});
