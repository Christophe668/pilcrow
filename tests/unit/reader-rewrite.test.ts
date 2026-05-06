import { describe, it, expect } from "vitest";
import { rewriteImages } from "@/images/rewrite";

describe("rewriteImages", () => {
  it("returns HTML unchanged when no images", () => {
    const r = rewriteImages("<p>hello</p>", () => null);
    expect(r.html).toBe("<p>hello</p>");
    expect(r.pendingSources).toEqual([]);
  });

  it("leaves uncached <img src> alone and reports it as pending", () => {
    const html = '<p><img src="https://x.com/a.png" alt="a"></p>';
    const r = rewriteImages(html, () => null);
    expect(r.html).toContain('src="https://x.com/a.png"');
    expect(r.pendingSources).toEqual(["https://x.com/a.png"]);
  });

  it("rewrites src to local path when cached", () => {
    const html = '<p><img src="https://x.com/a.png" alt="a"></p>';
    const r = rewriteImages(html, (src) =>
      src === "https://x.com/a.png" ? "file:///cache/a.png" : null,
    );
    expect(r.html).toContain('src="file:///cache/a.png"');
    expect(r.html).not.toContain("https://x.com/a.png");
    expect(r.pendingSources).toEqual([]);
  });

  it("handles multiple images, mixed cached and pending, deduped pending list", () => {
    const html =
      '<p><img src="https://x.com/a.png"><img src="https://x.com/b.png"><img src="https://x.com/a.png"></p>';
    const r = rewriteImages(html, (src) => (src === "https://x.com/a.png" ? "file:///a" : null));
    expect(r.pendingSources).toEqual(["https://x.com/b.png"]);
    expect(r.html.match(/src="file:\/\/\/a"/g)?.length).toBe(2);
  });

  it("respects single quotes around src", () => {
    const html = "<p><img src='https://x.com/a.png'></p>";
    const r = rewriteImages(html, (src) => (src === "https://x.com/a.png" ? "file:///a" : null));
    expect(r.html).toContain("src='file:///a'");
  });

  it("leaves data: URLs alone", () => {
    const html = '<p><img src="data:image/png;base64,abc"></p>';
    const r = rewriteImages(html, () => null);
    expect(r.html).toContain("data:image/png;base64,abc");
    expect(r.pendingSources).toEqual([]);
  });
});
