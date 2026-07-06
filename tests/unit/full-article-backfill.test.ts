import { describe, it, expect, beforeEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../src/test/msw-server";
import { createBetterSqliteDriver } from "@/db/driver-better-sqlite3";
import { runMigrations } from "@/db/migrations";
import type { DbDriver } from "@/db/driver";

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

import { fetchFullArticle } from "@/hooks/useFullArticle";
import { setDbForTesting } from "@/db";
import { applyTokenBundle } from "@/auth/tokens";

let db: DbDriver;

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
  db = await createBetterSqliteDriver(":memory:");
  await runMigrations(db);
  setDbForTesting(db);
});

describe("fetchFullArticle", () => {
  it("pulls server annotations when it backfills article content", async () => {
    await db.run("INSERT INTO articles (id, backend_id, url, title) VALUES (?, ?, ?, ?)", [
      50,
      "50",
      "https://x/50",
      "T50",
    ]);
    server.use(
      http.get("https://wb.test/api/entries/50.json", () =>
        HttpResponse.json({
          id: 50,
          title: "T50",
          url: "https://x/50",
          domain_name: "x",
          content: "<p>body</p>",
          preview_picture: null,
          reading_time: null,
          language: null,
          is_archived: 0,
          is_starred: 0,
          created_at: "2026-05-01T00:00:00Z",
          updated_at: "2026-05-10T00:00:00Z",
          starred_at: null,
          archived_at: null,
          published_at: null,
          published_by: null,
          tags: [],
        }),
      ),
      http.get("https://wb.test/api/annotations/50.json", () =>
        HttpResponse.json({
          total: 1,
          rows: [
            {
              id: 7,
              quote: "server highlight",
              text: null,
              ranges: [{ start: "/p[1]", startOffset: 0, end: "/p[1]", endOffset: 4 }],
              created_at: "2026-06-01T00:00:00Z",
              updated_at: "2026-06-01T00:00:00Z",
            },
          ],
        }),
      ),
    );

    const row = await fetchFullArticle(50);

    expect(row?.content).toBe("<p>body</p>");
    const anno = await db.get<{ quote: string }>("SELECT quote FROM annotations WHERE id = 7");
    expect(anno?.quote).toBe("server highlight");
  });
});
