export function normalizeServerUrl(input: string): string {
  const raw = input.trim();
  if (raw.length === 0) throw new Error("Server URL is required");
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error("Not a valid URL");
  }
  if (!url.hostname) throw new Error("Not a valid host");
  if (!/\./.test(url.hostname) && url.hostname !== "localhost") {
    throw new Error("Not a valid host");
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  return `${url.protocol}//${url.host}${pathname}`;
}

export function isLikelyServerUrl(input: string): boolean {
  try {
    normalizeServerUrl(input);
    return true;
  } catch {
    return false;
  }
}

const HTTP_URL_RE = /\bhttps?:\/\/[^\s<>"']+/i;

export function extractCandidateUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  const direct = HTTP_URL_RE.exec(trimmed);
  if (!direct) return null;
  const candidate = direct[0];

  try {
    const u = new URL(candidate);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname) return null;
    return candidate;
  } catch {
    return null;
  }
}
