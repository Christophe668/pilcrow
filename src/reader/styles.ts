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
}
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
p:first-of-type::first-letter {
  font-size: 3.4em;
  float: left;
  line-height: 0.92;
  padding: 6px 8px 0 0;
  font-weight: 500;
  color: var(--reader-accent);
}
a { color: var(--reader-accent); }
img, video { max-width: 100%; height: auto; border-radius: 8px; margin: 1em 0; }
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
pre, code {
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 0.9em;
  background: var(--reader-border);
  border-radius: 4px;
}
pre { padding: 0.75em 1em; overflow-x: auto; }
code { padding: 0.1em 0.3em; }
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
