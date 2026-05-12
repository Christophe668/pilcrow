import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  showSnackbar,
  dismissSnackbar,
  subscribeSnackbar,
  _testReset,
} from "@/components/snackbar-store";

beforeEach(() => {
  _testReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("snackbar store", () => {
  it("emits an item to subscribers when shown", () => {
    const seen: Array<string | null> = [];
    subscribeSnackbar((item) => seen.push(item?.message ?? null));
    showSnackbar({ message: "Archived" });
    expect(seen).toContain("Archived");
  });

  it("auto-dismisses after the duration", () => {
    const seen: Array<string | null> = [];
    subscribeSnackbar((item) => seen.push(item?.message ?? null));
    showSnackbar({ message: "Archived", durationMs: 1000 });
    expect(seen[seen.length - 1]).toBe("Archived");
    vi.advanceTimersByTime(1100);
    expect(seen[seen.length - 1]).toBeNull();
  });

  it("dismissSnackbar cancels the timer and clears", () => {
    const seen: Array<string | null> = [];
    subscribeSnackbar((item) => seen.push(item?.message ?? null));
    showSnackbar({ message: "Hello", durationMs: 5000 });
    dismissSnackbar();
    expect(seen[seen.length - 1]).toBeNull();
    // Advancing the timer should not emit again.
    const len = seen.length;
    vi.advanceTimersByTime(6000);
    expect(seen.length).toBe(len);
  });

  it("showing a new snackbar replaces the previous one and resets the timer", () => {
    showSnackbar({ message: "First", durationMs: 1000 });
    vi.advanceTimersByTime(500);
    showSnackbar({ message: "Second", durationMs: 1000 });
    const seen: Array<string | null> = [];
    subscribeSnackbar((item) => seen.push(item?.message ?? null));
    expect(seen[0]).toBe("Second");
    vi.advanceTimersByTime(500); // would have killed First by now, but Second has a fresh 1000ms
    expect(seen[seen.length - 1]).toBe("Second");
    vi.advanceTimersByTime(600);
    expect(seen[seen.length - 1]).toBeNull();
  });
});
