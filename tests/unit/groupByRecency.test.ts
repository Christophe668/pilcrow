import { describe, it, expect } from "vitest";
import { groupByRecency } from "@/lib/groupByRecency";

type Item = { id: number; ts: string | null };
const opts = (now: Date) => ({
  getTimestamp: (it: Item) => it.ts,
  getKey: (it: Item) => String(it.id),
  now,
});

describe("groupByRecency", () => {
  it("returns an empty array when given no items", () => {
    expect(groupByRecency<Item>([], opts(new Date("2026-05-08T12:00:00")))).toEqual([]);
  });

  it("buckets items into Today / Yesterday / Earlier this week / Earlier this month / month-name", () => {
    // Pin "now" to a Friday at 12:00 local. Items below cover each bucket.
    const now = new Date(2026, 4, 8, 12, 0, 0); // 8 May 2026, Fri
    const items: Item[] = [
      { id: 1, ts: new Date(2026, 4, 8, 9, 0, 0).toISOString() }, // today (this morning)
      { id: 2, ts: new Date(2026, 4, 7, 22, 0, 0).toISOString() }, // yesterday late
      { id: 3, ts: new Date(2026, 4, 5, 12, 0, 0).toISOString() }, // 3 days ago — this week
      { id: 4, ts: new Date(2026, 4, 1, 9, 0, 0).toISOString() }, // 7+ days ago, same month
      { id: 5, ts: new Date(2026, 3, 12, 9, 0, 0).toISOString() }, // April 2026
      { id: 6, ts: new Date(2025, 11, 24, 9, 0, 0).toISOString() }, // December 2025
    ];
    const grouped = groupByRecency(items, opts(now));
    const labels = grouped.filter((g) => g.kind === "header").map((g) => g.label);
    expect(labels).toEqual([
      "Today",
      "Yesterday",
      "Earlier this week",
      "Earlier this month",
      "April 2026",
      "December 2025",
    ]);
  });

  it("collapses adjacent items in the same bucket under one header", () => {
    const now = new Date(2026, 4, 8, 12, 0, 0);
    const items: Item[] = [
      { id: 1, ts: new Date(2026, 4, 8, 11, 0, 0).toISOString() },
      { id: 2, ts: new Date(2026, 4, 8, 9, 0, 0).toISOString() },
      { id: 3, ts: new Date(2026, 4, 8, 8, 0, 0).toISOString() },
    ];
    const grouped = groupByRecency(items, opts(now));
    expect(grouped.filter((g) => g.kind === "header")).toHaveLength(1);
    expect(grouped.filter((g) => g.kind === "item")).toHaveLength(3);
  });

  it("handles items with no/invalid timestamps under an Undated section", () => {
    const now = new Date(2026, 4, 8, 12, 0, 0);
    const items: Item[] = [
      { id: 1, ts: null },
      { id: 2, ts: "not-a-date" },
    ];
    const grouped = groupByRecency(items, opts(now));
    const headers = grouped.filter((g) => g.kind === "header");
    expect(headers).toHaveLength(1);
    expect(headers[0]!.label).toBe("Undated");
  });

  it("treats midnight-boundary items correctly (today snaps at local midnight, not 24h)", () => {
    // Now is 1am Friday. An item from 11pm last night should be "Yesterday",
    // not "Today" — the user just woke up; that thing isn't "today" anymore.
    const now = new Date(2026, 4, 8, 1, 0, 0);
    const items: Item[] = [
      { id: 1, ts: new Date(2026, 4, 7, 23, 0, 0).toISOString() }, // 11pm yesterday
    ];
    const grouped = groupByRecency(items, opts(now));
    expect(grouped[0]!.kind).toBe("header");
    if (grouped[0]!.kind === "header") {
      expect(grouped[0]!.label).toBe("Yesterday");
    }
  });
});
