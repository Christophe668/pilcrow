import type { ReaderPrefs } from "./prefs";
import { readerStylesTag } from "./styles";
import { READER_BRIDGE_FULL_JS } from "./bridge";
import { rewriteImages } from "@/images/rewrite";

export type BuildReaderArgs = {
  articleId: number;
  title: string | null;
  url: string;
  contentHtml: string;
  prefs: ReaderPrefs;
  imageLookup: (src: string) => string | null;
};

export type BuiltReader = {
  /** Complete HTML document for the WebView/iframe srcdoc. */
  document: string;
  /** Image sources still pending — caller can kick off downloads. */
  pendingImages: string[];
};

export function buildReaderHtml(args: BuildReaderArgs): BuiltReader {
  const { html: rewritten, pendingSources } = rewriteImages(args.contentHtml, args.imageLookup);

  const doc = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(args.title ?? args.url)}</title>
${readerStylesTag(args.prefs)}
</head>
<body>
<article>
${rewritten}
</article>
<script>${READER_BRIDGE_FULL_JS}</script>
</body>
</html>`;

  return { document: doc, pendingImages: pendingSources };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
