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
