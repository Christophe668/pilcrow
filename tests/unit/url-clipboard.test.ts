import { describe, it, expect } from "vitest";
import { extractCandidateUrl } from "@/lib/url";

describe("extractCandidateUrl", () => {
  it("returns the input verbatim when it's an http(s) URL", () => {
    expect(extractCandidateUrl("https://example.com/path")).toBe("https://example.com/path");
    expect(extractCandidateUrl("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("trims surrounding whitespace", () => {
    expect(extractCandidateUrl("  https://example.com/x  ")).toBe("https://example.com/x");
  });

  it("rejects non-http schemes", () => {
    expect(extractCandidateUrl("ftp://x.com")).toBeNull();
    expect(extractCandidateUrl("javascript:alert(1)")).toBeNull();
    expect(extractCandidateUrl("file:///etc/passwd")).toBeNull();
  });

  it("rejects strings without a valid host", () => {
    expect(extractCandidateUrl("just text")).toBeNull();
    expect(extractCandidateUrl("")).toBeNull();
    expect(extractCandidateUrl("https://")).toBeNull();
  });

  it("extracts the first http(s) URL from a longer string (paste-from-app)", () => {
    expect(extractCandidateUrl("Check this out https://example.com/x — fascinating")).toBe(
      "https://example.com/x",
    );
  });
});
