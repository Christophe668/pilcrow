import { describe, it, expect } from "vitest";
import { isExtractionFailed } from "@/reader/extraction-failed";

describe("isExtractionFailed", () => {
  it("flags x.com's JavaScript-disabled gatekeeper", () => {
    // Twitter/x's bot page: short text, no real article structure.
    const html = `
      <p>We've detected that JavaScript is disabled in this browser.
      Please enable JavaScript or switch to a supported browser to continue
      using x.com.</p>
      <p>Help Center</p>
    `;
    expect(isExtractionFailed(html)).toBe(true);
  });

  it("flags Cloudflare 'attention required' pages", () => {
    const html = "<h1>Attention Required! | Cloudflare</h1><p>Please enable cookies.</p>";
    expect(isExtractionFailed(html)).toBe(true);
  });

  it("flags an empty body", () => {
    expect(isExtractionFailed("")).toBe(true);
    expect(isExtractionFailed(null)).toBe(true);
    expect(isExtractionFailed("   <div></div>   ")).toBe(true);
  });

  it("does NOT flag a structured short article (one substantive headline + a few real paragraphs)", () => {
    // A real but short newsletter blurb. Two+ <p> with substantive text.
    const html = `
      <h1>Good Code vs. Bad Code</h1>
      <p>In our newsletter, we've mainly focused on system designs. This
      time, we're switching gears to a topic just as crucial: the code
      itself. Ever encountered a system that looks great in design but
      turns out to be a headache in code?</p>
      <p>Good code maintains stability and predictability, even as your
      project grows in complexity. It's like having a reliable tool that
      keeps performing, no matter how tough the job gets.</p>
    `;
    expect(isExtractionFailed(html)).toBe(false);
  });

  it("does NOT flag a long article that quotes a gatekeeper phrase in passing", () => {
    // Tech post that happens to mention "javascript is disabled" — the
    // structural signal saves us from a false positive.
    const html =
      "<article>" +
      Array.from({ length: 5 })
        .map(
          () =>
            "<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>",
        )
        .join("") +
      "<p>Note: some users see 'JavaScript is disabled in this browser.' when our analytics fail to load.</p>" +
      "</article>";
    expect(isExtractionFailed(html)).toBe(false);
  });

  it("does NOT flag a structured but very short newsletter intro", () => {
    // Two real paragraphs of meaningful prose — even though it's short, it
    // shouldn't be hidden behind a failure card.
    const html = `
      <p>Today's issue covers three new releases in the React ecosystem,
      with a focus on what's worth your attention this week.</p>
      <p>Read on for the rundown — we'll keep it brief and link out where
      it matters.</p>
    `;
    expect(isExtractionFailed(html)).toBe(false);
  });

  it("flags a div-only blob with a gatekeeper phrase (no <p>/<h*> structure)", () => {
    // Some servers wrap their challenge in <div> soup with no semantic
    // structure. That should still be caught.
    const html = `
      <div>
        <div>Please enable JavaScript to continue.</div>
        <div>If the problem persists, contact support.</div>
      </div>
    `;
    expect(isExtractionFailed(html)).toBe(true);
  });
});
