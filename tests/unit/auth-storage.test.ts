import { describe, it, expect, beforeEach, vi } from "vitest";
import { secureGet, secureSet, secureClear } from "@/auth/storage";

const mem = new Map<string, string>();
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (k: string) => mem.get(k) ?? null),
  setItemAsync: vi.fn(async (k: string, v: string) => void mem.set(k, v)),
  deleteItemAsync: vi.fn(async (k: string) => void mem.delete(k)),
}));

beforeEach(() => mem.clear());

describe("auth/storage", () => {
  it("returns null when missing", async () => {
    expect(await secureGet("access_token")).toBeNull();
  });

  it("round-trips a token", async () => {
    await secureSet("access_token", "abc");
    expect(await secureGet("access_token")).toBe("abc");
  });

  it("clears all keys", async () => {
    await secureSet("access_token", "a");
    await secureSet("refresh_token", "b");
    await secureSet("client_id", "c");
    await secureSet("client_secret", "d");
    await secureSet("username", "e");
    await secureSet("token_expires_at", "1");
    await secureClear();
    expect(await secureGet("access_token")).toBeNull();
    expect(await secureGet("refresh_token")).toBeNull();
    expect(await secureGet("client_id")).toBeNull();
    expect(await secureGet("client_secret")).toBeNull();
    expect(await secureGet("username")).toBeNull();
    expect(await secureGet("token_expires_at")).toBeNull();
  });
});
