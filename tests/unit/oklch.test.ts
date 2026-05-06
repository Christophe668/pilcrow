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
    const hex = oklchToHex(0.7, 0.3, 30);
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  });
});
