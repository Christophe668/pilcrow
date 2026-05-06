import { describe, it, expect } from "vitest";
import { readerStylesTag } from "@/reader/styles";

describe("readerStylesTag", () => {
  it("includes Newsreader as the default font family", () => {
    const css = readerStylesTag({ fontSize: "M", fontFamily: "serif", theme: "light" });
    expect(css).toContain("Newsreader");
  });

  it("scales font size", () => {
    const small = readerStylesTag({ fontSize: "S", fontFamily: "serif", theme: "light" });
    const large = readerStylesTag({ fontSize: "XL", fontFamily: "serif", theme: "light" });
    expect(small).toContain("--reader-base: 16px");
    expect(large).toContain("--reader-base: 22px");
  });

  it("dark theme uses dark palette", () => {
    const css = readerStylesTag({ fontSize: "M", fontFamily: "serif", theme: "dark" });
    expect(css).toMatch(/--reader-bg:\s*#1[0-9a-f]/i);
  });

  it("sans family overrides Newsreader", () => {
    const css = readerStylesTag({ fontSize: "M", fontFamily: "sans", theme: "light" });
    expect(css).toMatch(/--reader-font:\s*-apple-system/);
  });

  it("includes drop-cap rule and roomy body line-height", () => {
    const css = readerStylesTag({ fontSize: "M", fontFamily: "serif", theme: "light" });
    expect(css).toContain("p:first-of-type::first-letter");
    expect(css).toMatch(/line-height:\s*1\.65/);
  });
});
