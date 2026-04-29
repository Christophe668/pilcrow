/**
 * Helpers for the `?tags=` query parameter shared across all library
 * routes. Tags are stored as a comma-separated list of slugs in the URL so
 * the active filter set is shareable, deep-linkable, and visible in the
 * address bar on web.
 */

export function parseTagsParam(raw: string | string[] | undefined): string[] {
  // expo-router gives us either a single string or an array of strings if
  // the param appears multiple times. We accept both, then normalise.
  const collapsed = Array.isArray(raw) ? raw.join(",") : (raw ?? "");
  return collapsed
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function serializeTagsParam(slugs: readonly string[]): string | undefined {
  return slugs.length > 0 ? slugs.join(",") : undefined;
}

export function toggleTag(current: readonly string[], slug: string): string[] {
  return current.includes(slug) ? current.filter((s) => s !== slug) : [...current, slug];
}
