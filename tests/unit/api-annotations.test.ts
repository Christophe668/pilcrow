import { describe, it, expect, beforeEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../src/test/msw-server";

const secure = new Map<string, string>();
const asyncMem = new Map<string, string>();
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (k: string) => secure.get(k) ?? null),
  setItemAsync: vi.fn(async (k: string, v: string) => void secure.set(k, v)),
  deleteItemAsync: vi.fn(async (k: string) => void secure.delete(k)),
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (k: string) => asyncMem.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => void asyncMem.set(k, v)),
    removeItem: vi.fn(async (k: string) => void asyncMem.delete(k)),
  },
}));

import {
  listAnnotations,
  createAnnotation,
  updateAnnotation,
  deleteAnnotation,
} from "@/api/annotations";
import { applyTokenBundle } from "@/auth/tokens";

beforeEach(async () => {
  secure.clear();
  asyncMem.clear();
  secure.set("wb_client_id", "cid");
  secure.set("wb_client_secret", "cs");
  asyncMem.set("wb:server_url", "https://wb.test");
  await applyTokenBundle({
    access_token: "at",
    refresh_token: "rt",
    expires_in: 3600,
    token_type: "bearer",
  });
});

const fakeAnnotation = {
  id: 100,
  quote: "hi",
  text: "note",
  ranges: [{ start: "/p[1]", startOffset: 0, end: "/p[1]", endOffset: 2 }],
  created_at: "2026-05-01",
  updated_at: "2026-05-01",
};

describe("annotations API", () => {
  it("listAnnotations returns rows array", async () => {
    server.use(
      http.get("https://wb.test/api/annotations/9.json", () =>
        HttpResponse.json({ total: 1, rows: [fakeAnnotation] }),
      ),
    );
    const r = await listAnnotations(9);
    expect(r[0]?.id).toBe(100);
  });

  it("createAnnotation posts ranges + quote + text", async () => {
    server.use(
      http.post("https://wb.test/api/annotations/9.json", async ({ request }) => {
        const body = (await request.json()) as { quote: string };
        expect(body.quote).toBe("hi");
        return HttpResponse.json(fakeAnnotation);
      }),
    );
    const r = await createAnnotation(9, {
      quote: "hi",
      ranges: fakeAnnotation.ranges,
      text: "note",
    });
    expect(r.id).toBe(100);
  });

  it("updateAnnotation PUTs", async () => {
    server.use(
      http.put("https://wb.test/api/annotations/100.json", () =>
        HttpResponse.json({ ...fakeAnnotation, text: "updated" }),
      ),
    );
    const r = await updateAnnotation(100, { text: "updated" });
    expect(r.text).toBe("updated");
  });

  it("deleteAnnotation DELETEs", async () => {
    let called = false;
    server.use(
      http.delete("https://wb.test/api/annotations/100.json", () => {
        called = true;
        return HttpResponse.json({ ok: true });
      }),
    );
    await deleteAnnotation(100);
    expect(called).toBe(true);
  });
});
