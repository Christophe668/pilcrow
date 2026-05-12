import { describe, it, expect, beforeEach } from "vitest";
import { createBetterSqliteDriver } from "@/db/driver-better-sqlite3";
import type { DbDriver } from "@/db/driver";

let db: DbDriver;

beforeEach(async () => {
  db = await createBetterSqliteDriver(":memory:");
  await db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
});

describe("DbDriver", () => {
  it("runs and returns rowid + changes", async () => {
    const r = await db.run("INSERT INTO t (name) VALUES (?)", ["a"]);
    expect(r.changes).toBe(1);
    expect(Number(r.lastId)).toBeGreaterThan(0);
  });

  it("get returns first row or null", async () => {
    expect(await db.get<{ id: number }>("SELECT id FROM t WHERE name = ?", ["x"])).toBeNull();
    await db.run("INSERT INTO t (name) VALUES (?)", ["x"]);
    const row = await db.get<{ id: number; name: string }>(
      "SELECT id, name FROM t WHERE name = ?",
      ["x"],
    );
    expect(row?.name).toBe("x");
  });

  it("all returns array", async () => {
    await db.run("INSERT INTO t (name) VALUES (?), (?)", ["a", "b"]);
    const rows = await db.all<{ name: string }>("SELECT name FROM t ORDER BY id");
    expect(rows.map((r) => r.name)).toEqual(["a", "b"]);
  });

  it("transaction commits on success", async () => {
    await db.transaction(async (tx) => {
      await tx.run("INSERT INTO t (name) VALUES (?)", ["c"]);
      await tx.run("INSERT INTO t (name) VALUES (?)", ["d"]);
    });
    const rows = await db.all<{ name: string }>("SELECT name FROM t ORDER BY id");
    expect(rows.map((r) => r.name)).toEqual(["c", "d"]);
  });

  it("transaction rolls back on throw", async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.run("INSERT INTO t (name) VALUES (?)", ["c"]);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const rows = await db.all<{ name: string }>("SELECT name FROM t");
    expect(rows.length).toBe(0);
  });
});
