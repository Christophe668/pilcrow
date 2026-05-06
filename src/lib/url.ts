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
