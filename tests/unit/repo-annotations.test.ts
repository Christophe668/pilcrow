import { describe, it, expect, beforeEach } from "vitest";
import { createBetterSqliteDriver } from "@/db/driver-better-sqlite3";
import { runMigrations } from "@/db/migrations";
import type { DbDriver } from "@/db/driver";
import {
  upsertAnnotations,
  listAnnotations,
  createAnnotation,
  deleteAnnotation,
} from "@/db/repos/annotations";

let db: DbDriver;

beforeEach(async () => {
  db = await createBetterSqliteDriver(":memory:");
  await runMigrations(db);
  await db.run("INSERT INTO articles (id, url) VALUES (?, ?)", [1, "https://example.com/a"]);
});

describe("annotations repo", () => {
  it("upserts and lists by article", async () => {
    await upsertAnnotations(db, [
      {
        id: 10,
        article_id: 1,
        quote: "hello",
        ranges_json: "[]",
        text: "note 1",
        created_at: "2026-05-01T00:00:00Z",
        updated_at: "2026-05-01T00:00:00Z",
      },
    ]);
    const list = await listAnnotations(db, 1);
    expect(list.map((a) => a.quote)).toEqual(["hello"]);
  });

  it("createAnnotation generates a temp negative id and pending_op = create", async () => {
    const id = await createAnnotation(db, {
      article_id: 1,
      quote: "fresh",
      ranges_json: "[]",
      text: null,
    });
    expect(id).toBeLessThan(0);
    const list = await listAnnotations(db, 1);
    expect(list[0]?.pending_op).toBe("create");
  });

  it("deleteAnnotation marks for delete (does not row-remove until drained)", async () => {
    await upsertAnnotations(db, [
      {
        id: 10,
        article_id: 1,
        quote: "x",
        ranges_json: "[]",
        text: null,
        created_at: "2026-05-01T00:00:00Z",
        updated_at: "2026-05-01T00:00:00Z",
      },
    ]);
    await deleteAnnotation(db, 10);
    const row = (await listAnnotations(db, 1))[0];
    expect(row?.pending_op).toBe("delete");
  });
});
