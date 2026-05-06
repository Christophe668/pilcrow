export type RewriteResult = { html: string; pendingSources: string[] };

const IMG_SRC_RE = /<img\b([^>]*?)\bsrc=(["'])([^"']*)\2/gi;

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
