import type { ReaderPrefs } from "./prefs";

const SIZE_PX: Record<ReaderPrefs["fontSize"], number> = {
  S: 16,
  M: 18,
  L: 20,
  XL: 22,
};

const SERIF_STACK = `'Newsreader','Iowan Old Style','Charter',Georgia,serif`;
const SANS_STACK = `-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',system-ui,sans-serif`;

type Palette = { bg: string; fg: string; muted: string; border: string; accent: string };

const LIGHT: Palette = {
  bg: "#fbf8f4",
  fg: "#1c140e",
  muted: "#5e5650",
  border: "#e6e0da",
  accent: "#c1291b",
};
const DARK: Palette = {
  bg: "#161310",
  fg: "#f1ebe1",
  muted: "#a59c92",
  border: "#2a2520",
  accent: "#e87a6a",
};
const SEPIA: Palette = {
  bg: "#f4ecd8",
  fg: "#2b1d12",
  muted: "#604a30",
  border: "#dfd1ad",
  accent: "#a93a17",
};

export function readerStylesTag(prefs: ReaderPrefs): string {
  const base = SIZE_PX[prefs.fontSize];
  const fontFamily = prefs.fontFamily === "sans" ? SANS_STACK : SERIF_STACK;
  const p = prefs.theme === "dark" ? DARK : prefs.theme === "sepia" ? SEPIA : LIGHT;
  return `<style>
:root {
  --reader-base: ${base}px;
  --reader-bg: ${p.bg};
  --reader-fg: ${p.fg};
  --reader-muted: ${p.muted};
  --reader-border: ${p.border};
  --reader-accent: ${p.accent};
  --reader-font: ${fontFamily};
}
html, body { margin: 0; padding: 0; background: var(--reader-bg); color: var(--reader-fg); }
body {
  font-family: var(--reader-font);
  font-size: var(--reader-base);
  line-height: 1.65;
  padding: 24px 20px 80px;
  max-width: 680px;
  margin: 0 auto;
  -webkit-text-size-adjust: 100%;
  position: relative;
}
/* Magazine-style column rule on the left margin. The base rule is always
   visible; the accent rule grows from the top as the reader scrolls — the
   bridge updates --read-progress on scroll. The rule sits just outside the
   body's max-width column so it reads as a margin marker, not a divider. */
html::before, html::after {
  content: '';
  position: fixed;
  top: 0;
  width: 1.5px;
  pointer-events: none;
  /* Pin to the left edge of the body's centered column, with 12px gutter. */
  left: max(8px, calc(50vw - 340px - 12px));
  z-index: 1;
}
html::before {
  bottom: 0;
  background: var(--reader-border);
  opacity: 0.6;
}
html::after {
  height: var(--read-progress, 0%);
  background: var(--reader-accent);
  transition: height 80ms linear;
}
article > h1:first-child, article > h2:first-child, article > h3:first-child { margin-top: 0; }
h1, h2, h3 { font-family: var(--reader-font); line-height: 1.2; margin-top: 1.5em; }
h1 {
  font-size: 2.2em;
  line-height: 1.05;
  letter-spacing: -0.025em;
  font-weight: 500;
  margin: 0 0 0.5em;
  text-wrap: balance;
}
h2 { font-size: 1.3em; font-weight: 600; }
h3 { font-size: 1.1em; font-weight: 600; }
p { margin: 0 0 1em; text-wrap: pretty; }
/* Drop cap only on the very first paragraph that's a direct child of <article> —
   never inside blockquotes, list items, or code blocks. */
article > p:first-of-type::first-letter {
  font-size: 3.4em;
  float: left;
  line-height: 0.92;
  padding: 6px 8px 0 0;
  font-weight: 500;
  color: var(--reader-accent);
}
a { color: var(--reader-accent); }
img, video { max-width: 100%; height: auto; border-radius: 8px; margin: 1em 0; }
ul, ol { margin: 0 0 1em; padding-inline-start: 1.4em; }
li { margin-bottom: 0.4em; }
li > p { margin: 0 0 0.4em; }
blockquote {
  font-style: italic;
  font-size: 1.15em;
  line-height: 1.45;
  color: var(--reader-fg);
  margin: 1.6em 0;
  padding-left: 1.2em;
  border-left: 2px solid var(--reader-accent);
  text-wrap: balance;
}
pre {
  font-family: ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace;
  font-size: 0.85em;
  font-style: normal;
  line-height: 1.5;
  background: ${p.bg === DARK.bg ? "#0e0c0a" : p.bg === SEPIA.bg ? "#ece2c8" : "#f0eae2"};
  color: var(--reader-fg);
  border: 1px solid var(--reader-border);
  border-radius: 8px;
  padding: 12px 14px;
  margin: 1.4em 0;
  overflow-x: auto;
  white-space: pre;
  word-wrap: normal;
  -webkit-text-size-adjust: none;
}
pre code {
  font-family: inherit;
  font-size: inherit;
  background: transparent;
  border: 0;
  padding: 0;
  color: inherit;
  white-space: inherit;
}
code {
  font-family: ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace;
  font-size: 0.88em;
  font-style: normal;
  background: ${p.bg === DARK.bg ? "#2a2520" : p.bg === SEPIA.bg ? "#dfd1ad" : "#ece5dc"};
  color: var(--reader-fg);
  border-radius: 4px;
  padding: 0.1em 0.35em;
  white-space: pre-wrap;
}
hr { border: 0; border-top: 1px solid var(--reader-border); margin: 2em 0; }
mark {
  background: ${p.bg === DARK.bg ? "#5e5526" : "#f6e6a8"};
  color: var(--reader-fg);
  padding: 0 2px;
  border-radius: 2px;
}
::selection { background: color-mix(in oklch, var(--reader-accent) 30%, transparent); }
</style>`;
}
