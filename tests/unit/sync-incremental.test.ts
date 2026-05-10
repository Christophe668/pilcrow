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

import { runIncrementalSync } from "@/sync/engine";
import { setSyncValue } from "@/db/repos/sync-state";
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

const entry = (id: number, updated: string) => ({
  id,
  title: `T${id}`,
  url: `https://x/${id}`,
  domain_name: "x",
  content: null,
  preview_picture: null,
  reading_time: null,
  language: null,
  is_archived: 0 as const,
  is_starred: 0 as const,
  created_at: "2026-05-01T00:00:00Z",
  updated_at: updated,
  starred_at: null,
  archived_at: null,
  published_at: null,
  published_by: null,
  tags: [],
});

describe("runIncrementalSync", () => {
  it("forwards stored since timestamp and updates it", async () => {
    await setSyncValue(db, "last_since", "1700000000");
    let capturedSince: string | null = null;
    server.use(
      http.get("https://wb.test/api/entries.json", ({ request }) => {
        capturedSince = new URL(request.url).searchParams.get("since");
        return HttpResponse.json({
          page: 1,
          pages: 1,
          limit: 100,
          total: 1,
          _embedded: { items: [entry(50, "2026-05-10T00:00:00Z")] },
        });
      }),
      http.get("https://wb.test/api/tags.json", () => HttpResponse.json([])),
    );

    await runIncrementalSync();

    expect(capturedSince).toBe("1700000000");
    const stored = await db.get<{ value: string }>(
      "SELECT value FROM sync_state WHERE key = 'last_since'",
    );
    expect(Number(stored?.value)).toBeGreaterThan(1700000000);
  });

  it("upserts updated entries", async () => {
    await db.run(
      "INSERT INTO articles (id, backend_id, url, title, updated_at) VALUES (?, ?, ?, ?, ?)",
      [50, "50", "https://x/50", "Old", "2026-04-01T00:00:00Z"],
    );
    server.use(
      http.get("https://wb.test/api/entries.json", () =>
        HttpResponse.json({
          page: 1,
          pages: 1,
          limit: 100,
          total: 1,
          _embedded: { items: [entry(50, "2026-05-10T00:00:00Z")] },
        }),
      ),
      http.get("https://wb.test/api/tags.json", () => HttpResponse.json([])),
    );

    await runIncrementalSync();

    const a = await db.get<{ title: string; updated_at: string }>(
      "SELECT title, updated_at FROM articles WHERE id = 50",
    );
    expect(a?.title).toBe("T50");
    expect(a?.updated_at).toBe("2026-05-10T00:00:00Z");
  });
});
