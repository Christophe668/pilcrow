/**
 * Bucket dated items into editorial-style time sections — Today, Yesterday,
 * This week, Earlier this month, and named-month buckets for older items.
 * Used by the article list to interleave section headers between cards so
 * the page reads as a dated archive rather than an undifferentiated stream.
 *
 * The grouping is calendar-aware (anchored on local-midnight boundaries),
 * not duration-based — "yesterday" means the previous local day, regardless
 * of the current hour. That matches how readers think about recency, where
 * "today" snaps at midnight, not 24h ago.
 */

export type Grouped<T> =
  | { kind: "header"; key: string; label: string }
  | { kind: "item"; key: string; item: T };

export type GroupOptions<T> = {
  /** Returns the timestamp (any Date-parseable string) for an item. */
  getTimestamp: (item: T) => string | null | undefined;
  /** Returns a stable string key for an item. */
  getKey: (item: T) => string;
  /** Anchor "now" — defaults to current Date. Pass a fixed value in tests. */
  now?: Date;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function groupByRecency<T>(items: readonly T[], opts: GroupOptions<T>): Grouped<T>[] {
  if (items.length === 0) return [];
  const now = opts.now ?? new Date();
  const todayStart = startOfDay(now);
  const yesterdayStart = new Date(todayStart.getTime() - MS_PER_DAY);
  const weekStart = new Date(todayStart.getTime() - 6 * MS_PER_DAY); // last 7 days incl. today
  const monthStart = startOfMonth(now);

  const out: Grouped<T>[] = [];
  let lastBucket: string | null = null;
  for (const item of items) {
    const ts = parseDate(opts.getTimestamp(item));
    const bucket = bucketFor(ts, { todayStart, yesterdayStart, weekStart, monthStart });
    if (bucket !== lastBucket) {
      out.push({ kind: "header", key: `__h:${bucket}`, label: labelFor(bucket) });
      lastBucket = bucket;
    }
    out.push({ kind: "item", key: opts.getKey(item), item });
  }
  return out;
}

function bucketFor(
  ts: Date | null,
  bounds: { todayStart: Date; yesterdayStart: Date; weekStart: Date; monthStart: Date },
): string {
  if (!ts) return "unknown";
  if (ts >= bounds.todayStart) return "today";
  if (ts >= bounds.yesterdayStart) return "yesterday";
  if (ts >= bounds.weekStart) return "this-week";
  if (ts >= bounds.monthStart) return "this-month";
  // Older: bucket by calendar month so "March 2026", "February 2026", etc.
  // are separate sections.
  return `m:${ts.getFullYear()}-${String(ts.getMonth()).padStart(2, "0")}`;
}

function labelFor(bucket: string): string {
  switch (bucket) {
    case "today":
      return "Today";
    case "yesterday":
      return "Yesterday";
    case "this-week":
      return "Earlier this week";
    case "this-month":
      return "Earlier this month";
    case "unknown":
      return "Undated";
  }
  if (bucket.startsWith("m:")) {
    const [, ym] = bucket.split(":");
    if (!ym) return "Earlier";
    const [yearStr, monthStr] = ym.split("-");
    const year = Number(yearStr);
    const monthIdx = Number(monthStr);
    if (Number.isFinite(year) && Number.isFinite(monthIdx) && MONTHS[monthIdx]) {
      return `${MONTHS[monthIdx]} ${year}`;
    }
  }
  return "Earlier";
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
