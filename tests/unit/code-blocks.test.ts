import { describe, it, expect } from "vitest";
import { rewriteCodeBlocks } from "@/reader/code-blocks";

describe("rewriteCodeBlocks", () => {
  it("leaves regular prose paragraphs alone", () => {
    const input = "<p>Hello world.</p><p>Another sentence.</p>";
    expect(rewriteCodeBlocks(input)).toBe(input);
  });

  it("collapses a <div> of code-like <p> lines into a <pre><code>", () => {
    const input =
      '<div><p dir="ltr">val currentWindowMetrics =</p>' +
      '<p dir="ltr">WindowMetricsCalculator.getOrCreate()</p>' +
      '<p dir="ltr">  .computeCurrentWindowMetrics(LocalContext.current)</p></div>';
    const out = rewriteCodeBlocks(input);
    expect(out).toContain("<pre><code>");
    expect(out).toContain("val currentWindowMetrics =");
    expect(out).toContain("WindowMetricsCalculator.getOrCreate()");
    expect(out).not.toMatch(/<p[\s>]/);
  });

  it("preserves a non-code <div> of paragraphs (e.g. callouts)", () => {
    const input =
      "<div><p>This is a regular sentence about something.</p>" +
      "<p>Followed by another regular sentence with more words.</p></div>";
    expect(rewriteCodeBlocks(input)).toBe(input);
  });

  it("handles HTML-encoded angle brackets inside the code", () => {
    const input = "<div><p>if (a &lt; b) {</p>" + "<p>  return a;</p>" + "<p>}</p></div>";
    const out = rewriteCodeBlocks(input);
    expect(out).toContain("<pre><code>");
    expect(out).toContain("if (a &lt; b) {");
  });

  it("leaves a div alone when it contains non-<p> children", () => {
    const input = "<div><h2>Heading</h2><p>val x = 1</p><p>val y = 2</p></div>";
    expect(rewriteCodeBlocks(input)).toBe(input);
  });

  it("requires at least 2 paragraphs", () => {
    const input = "<div><p>val x = 1;</p></div>";
    expect(rewriteCodeBlocks(input)).toBe(input);
  });
});
