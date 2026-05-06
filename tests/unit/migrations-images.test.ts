import { describe, it, expect, beforeEach } from "vitest";
import { createBetterSqliteDriver } from "@/db/driver-better-sqlite3";
import { runMigrations } from "@/db/migrations";
import type { DbDriver } from "@/db/driver";

let db: DbDriver;

beforeEach(async () => {
  db = await createBetterSqliteDriver(":memory:");
  await runMigrations(db);
  await db.run("INSERT INTO articles (id, url) VALUES (1, 'https://x')");
});

describe("images migration", () => {
  it("creates images table with expected columns", async () => {
    const cols = await db.all<{ name: string }>("PRAGMA table_info(images)");
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(
      ["article_id", "cached_at", "local_path", "size_bytes", "src", "status"].sort(),
    );
  });

  it("composite primary key prevents duplicate (article_id, src) rows", async () => {
    await db.run("INSERT INTO images (article_id, src, status) VALUES (?, ?, 'pending')", [
      1,
      "https://example.com/a.png",
    ]);
    await expect(
      db.run("INSERT INTO images (article_id, src, status) VALUES (?, ?, 'pending')", [
        1,
        "https://example.com/a.png",
      ]),
    ).rejects.toThrow();
  });
});
