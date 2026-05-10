import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

const TITLE = "Pilcrow — a reader for Wallabag";
const DESCRIPTION =
  "Pilcrow is a cross-platform reading client for self-hosted Wallabag — clean typography, offline-first, with highlights and notes.";

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <title>{TITLE}</title>
        <meta name="description" content={DESCRIPTION} />
        <meta name="theme-color" content="#fbf8f4" />
        <meta property="og:title" content={TITLE} />
        <meta property="og:description" content={DESCRIPTION} />
        <meta property="og:type" content="website" />
        <meta property="og:image" content="/assets/landing/og.png" />
        <meta name="twitter:card" content="summary_large_image" />
        <link rel="icon" href="/favicon.ico" />
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
