import { describe, it, expect, beforeEach, vi } from "vitest";
import { kvGet, kvSet, kvRemove } from "@/lib/async-storage";

const mem = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (k: string) => mem.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => void mem.set(k, v)),
    removeItem: vi.fn(async (k: string) => void mem.delete(k)),
  },
}));

beforeEach(() => mem.clear());

describe("async-storage wrapper", () => {
  it("returns null when key absent", async () => {
    expect(await kvGet("server_url")).toBeNull();
  });

  it("round-trips strings", async () => {
    await kvSet("server_url", "https://example.com");
    expect(await kvGet("server_url")).toBe("https://example.com");
  });

  it("removes a key", async () => {
    await kvSet("server_url", "https://example.com");
    await kvRemove("server_url");
    expect(await kvGet("server_url")).toBeNull();
  });
});
