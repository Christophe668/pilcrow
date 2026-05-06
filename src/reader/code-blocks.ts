/**
 * Wallabag (and the upstream readability/Mercury parsers it relies on) tend to
 * lose `<pre>` formatting when extracting articles from sites that ship code
 * snippets through Google-Docs-style markup. The result is HTML like:
 *
 *   <div>
 *     <p dir="ltr">val currentWindowMetrics =</p>
 *     <p dir="ltr">WindowMetricsCalculator.getOrCreate()</p>
 *     <p dir="ltr">  .computeCurrentWindowMetrics(LocalContext.current)</p>
 *   </div>
 *
 * Each line is its own `<p>`, so the reader stylesheet renders them as flowing
 * serif paragraphs — unreadable for code. This module rewrites such groups
 * into a single `<pre><code>` block joined by newlines, keeping the original
 * markup intact when the block doesn't look like code.
 *
 * Heuristics used:
 *   - The container is a plain `<div>` (or `<div dir="ltr">`).
 *   - It contains only `<p>` siblings (whitespace ignored).
 *   - There are at least 2 paragraphs.
 *   - The combined text contains punctuation typical of code: at least 2 of
 *     `( ) { } [ ] = ; < > / \ |` AND the average word length is short.
 */

const CODE_PUNCT_RE = /[(){}[\]=;<>\\|]/g;

function looksLikeCode(text: string): boolean {
  if (text.length === 0) return false;
  const punctMatches = text.match(CODE_PUNCT_RE);
  const punctCount = punctMatches ? punctMatches.length : 0;
  if (punctCount < 2) return false;

  // Lines starting with common code keywords / patterns.
  const codeKeywordRe =
    /\b(val|var|let|const|function|def|class|if|else|for|while|return|import|from|public|private|static|void|int|string|fn|impl|struct|module|export)\b|\bawait\b|=>|::|\.\w+\(/;
  if (codeKeywordRe.test(text)) return true;

  // Or: short average word length + lots of punctuation.
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  const avg = text.length / words.length;
  return avg <= 10 && punctCount >= 4;
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Find `<div>...<p>...</p>... </div>` blocks where all children are `<p>` and
 * collapse them into a single `<pre><code>...</code></pre>` when the contents
 * look like source code.
 */
export function rewriteCodeBlocks(html: string): string {
  const divRe = /<div(?:\s+[^>]*)?>([\s\S]*?)<\/div>/gi;

  return html.replace(divRe, (match, inner: string) => {
    // Reject divs containing anything other than <p> elements + whitespace.
    const stripped = inner.replace(/<p(?:\s+[^>]*)?>[\s\S]*?<\/p>/gi, "").trim();
    if (stripped.length > 0) return match;

    const paragraphs: string[] = [];
    const pRe = /<p(?:\s+[^>]*)?>([\s\S]*?)<\/p>/gi;
    let m: RegExpExecArray | null;
    while ((m = pRe.exec(inner)) !== null) {
      paragraphs.push(m[1] ?? "");
    }
    if (paragraphs.length < 2) return match;

    // Decode each line and check the joined text for code-ishness.
    const lines = paragraphs.map((p) => decode(p.replace(/<[^>]+>/g, "")));
    const joined = lines.join("\n");
    if (!looksLikeCode(joined)) return match;

    return `<pre><code>${escape(joined)}</code></pre>`;
  });
}
