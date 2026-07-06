export type RewriteResult = { html: string; pendingSources: string[] };

const IMG_SRC_RE = /<img\b([^>]*?)\bsrc=(["'])([^"']*)\2/gi;

/** Distinct downloadable image URLs in `html` (absolute http(s) only). */
export function extractImageSources(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(IMG_SRC_RE)) {
    const src = m[3];
    if (src && /^https?:\/\//i.test(src)) out.add(src);
  }
  return [...out];
}

export function rewriteImages(html: string, lookup: (src: string) => string | null): RewriteResult {
  const pending = new Set<string>();
  const out = html.replace(IMG_SRC_RE, (match, before: string, quote: string, src: string) => {
    if (src.startsWith("data:")) return match;
    const local = lookup(src);
    if (local) {
      return `<img${before} src=${quote}${local}${quote}`;
    }
    pending.add(src);
    return match;
  });
  return { html: out, pendingSources: Array.from(pending) };
}
