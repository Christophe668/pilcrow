import { describe, it, expect, beforeEach } from "vitest";
import { createBetterSqliteDriver } from "@/db/driver-better-sqlite3";
import { runMigrations } from "@/db/migrations";
import type { DbDriver } from "@/db/driver";
import {
  rememberPending,
  markCached,
  markFailed,
  getImage,
  imagesForArticle,
  pickEvictionCandidates,
} from "@/images/repo";

let db: DbDriver;

beforeEach(async () => {
  db = await createBetterSqliteDriver(":memory:");
  await runMigrations(db);
  await db.run("INSERT INTO articles (id, url) VALUES (1, 'https://x')");
  await db.run("INSERT INTO articles (id, url) VALUES (2, 'https://y')");
});

describe("images repo", () => {
  it("rememberPending inserts a row with status='pending'", async () => {
    await rememberPending(db, 1, "https://example.com/a.png");
    const row = await getImage(db, 1, "https://example.com/a.png");
    expect(row?.status).toBe("pending");
    expect(row?.local_path).toBeNull();
  });

  it("rememberPending is idempotent", async () => {
    await rememberPending(db, 1, "https://example.com/a.png");
    await rememberPending(db, 1, "https://example.com/a.png");
    expect((await imagesForArticle(db, 1)).length).toBe(1);
  });

  it("markCached records local path + size", async () => {
    await rememberPending(db, 1, "https://example.com/a.png");
    await markCached(db, 1, "https://example.com/a.png", "file:///cache/a.png", 1234);
    const row = await getImage(db, 1, "https://example.com/a.png");
    expect(row?.status).toBe("cached");
    expect(row?.local_path).toBe("file:///cache/a.png");
    expect(row?.size_bytes).toBe(1234);
    expect(row?.cached_at).toBeTruthy();
  });

  it("markFailed records status without local_path", async () => {
    await rememberPending(db, 1, "https://example.com/a.png");
    await markFailed(db, 1, "https://example.com/a.png");
    const row = await getImage(db, 1, "https://example.com/a.png");
    expect(row?.status).toBe("failed");
    expect(row?.local_path).toBeNull();
  });

  it("pickEvictionCandidates returns oldest cached rows up to a byte budget", async () => {
    const insert = async (articleId: number, src: string, cachedAt: string, bytes: number) => {
      await rememberPending(db, articleId, src);
      await markCached(db, articleId, src, `file:///${src.split("/").pop()}`, bytes);
      await db.run("UPDATE images SET cached_at = ? WHERE article_id = ? AND src = ?", [
        cachedAt,
        articleId,
        src,
      ]);
    };
    await insert(1, "https://x.com/a.png", "2026-05-01", 1000);
    await insert(1, "https://x.com/b.png", "2026-05-02", 1000);
    await insert(2, "https://y.com/c.png", "2026-05-03", 1000);
    await insert(2, "https://y.com/d.png", "2026-05-04", 1000);

    const candidates = await pickEvictionCandidates(db, 1500);
    expect(candidates.map((c) => c.src)).toEqual(["https://x.com/a.png", "https://x.com/b.png"]);
  });
});
