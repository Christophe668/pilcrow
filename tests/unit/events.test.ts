import { describe, it, expect, vi } from "vitest";
import { dataEvents, type DataChangeEvent } from "@/sync/events";

describe("data events bus", () => {
  it("emits and unsubscribes", () => {
    const seen: DataChangeEvent[] = [];
    const off = dataEvents.subscribe((e) => seen.push(e));
    dataEvents.emit({ kind: "articles" });
    dataEvents.emit({ kind: "tags" });
    off();
    dataEvents.emit({ kind: "articles" });
    expect(seen.map((e) => e.kind)).toEqual(["articles", "tags"]);
  });

  it("multiple subscribers all fire", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = dataEvents.subscribe(a);
    const offB = dataEvents.subscribe(b);
    dataEvents.emit({ kind: "annotations", articleId: 1 });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    offB();
  });
});
