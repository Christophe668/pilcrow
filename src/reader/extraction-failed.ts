/**
 * Heuristic: did Wallabag's server-side fetcher get a real article, or did
 * it land on a JS-required gatekeeper / login wall / blocked page? Some
 * sites (x.com, many Cloudflare-protected pages, paywalled news) return
 * placeholder HTML that Wallabag dutifully stores as the article body. We
 * detect those cases so the reader can show a helpful "open original" card
 * instead of rendering the gibberish.
 *
 * The heuristic is structural: we trust article HTML that has multiple
 * substantive paragraphs or headings — gatekeeper pages don't. We only
 * fall through to phrase-matching when structure is absent, so a real
 * article that happens to mention "subscribe to read" in passing is never
 * flagged.
 */

const GATEKEEPER_PHRASES = [
  // x.com / Twitter
  "javascript is disabled in this browser",
  "we've detected that javascript is disabled",
  "switch to a supported browser",
  // Cloudflare / DDoS protection
  "checking your browser before accessing",
  "please enable cookies and reload",
  "ddos protection by cloudflare",
  "attention required! | cloudflare",
  "you need to enable javascript to run this app",
  // Generic JS / cookie walls
  "please enable javascript to continue",
  "enable javascript and cookies to continue",
  "this site requires javascript",
];

const MIN_SUBSTANTIVE_PARAS = 2;
const SUBSTANTIVE_PARA_CHARS = 80;

export function isExtractionFailed(html: string | null | undefined): boolean {
  if (!html) return true;
  const stripped = stripHtml(html);
  if (stripped.length === 0) return true;

  // Primary signal: structural. Two or more substantive paragraphs or
  // headings is the floor for a real article body. Real articles cross it
  // easily; gatekeeper pages don't even get close.
  if (countSubstantiveBlocks(html) >= MIN_SUBSTANTIVE_PARAS) return false;

  // No real structure. If the content also matches a known gatekeeper
  // phrase, we're confident it's a placeholder. Otherwise we trust it —
  // a structured-but-short snippet (a one-liner blog post, a news brief)
  // shouldn't be hidden.
  const lower = stripped.toLowerCase();
  return GATEKEEPER_PHRASES.some((phrase) => lower.includes(phrase));
}

/**
 * Counts <p> and <h1>-<h6> blocks whose stripped inner text exceeds the
 * substantive-prose threshold. Cheap regex pass — we don't need a real
 * parser to tell the difference between "an article" and "the bare
 * Cloudflare challenge".
 */
function countSubstantiveBlocks(html: string): number {
  let count = 0;
  const re = /<(p|h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const inner = stripHtml(match[2] ?? "");
    if (inner.length >= SUBSTANTIVE_PARA_CHARS) {
      count++;
      if (count >= MIN_SUBSTANTIVE_PARAS) return count;
    }
  }
  return count;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}
