import { describe, it, expect, beforeEach, vi } from "vitest";
import { createBetterSqliteDriver } from "@/db/driver-better-sqlite3";
import { runMigrations } from "@/db/migrations";
import type { DbDriver } from "@/db/driver";
import type { Backend, BackendAnnotation } from "@/api/backend";
import { upsertAnnotations, listAnnotations } from "@/db/repos/annotations";
import { dataEvents, type DataChangeEvent } from "@/sync/events";
import { pullAnnotations, pullAnnotationsForArticle } from "@/sync/annotations-pull";

let db: DbDriver;

beforeEach(async () => {
  db = await createBetterSqliteDriver(":memory:");
  await runMigrations(db);
});

function makeBackend(
  annotationsByArticle: Record<string, BackendAnnotation[]>,
  opts: { localIdMatchesBackendId?: boolean; annotations?: boolean } = {},
): Backend & { listCalls: string[] } {
  const listCalls: string[] = [];
  return {
    kind: "wallabag",
    capabilities: {
      reloadArticle: true,
      annotations: opts.annotations ?? true,
      localIdMatchesBackendId: opts.localIdMatchesBackendId ?? true,
    },
    listCalls,
    async listAnnotations(articleId) {
      listCalls.push(articleId);
      return annotationsByArticle[articleId] ?? [];
    },
    listArticles: vi.fn(),
    getArticle: vi.fn(),
    createArticle: vi.fn(),
    patchArticle: vi.fn(),
    deleteArticle: vi.fn(),
    reloadArticle: vi.fn(),
    listTags: vi.fn(),
    addTagsToArticle: vi.fn(),
    removeTagFromArticle: vi.fn(),
    createAnnotation: vi.fn(),
    updateAnnotation: vi.fn(),
    deleteAnnotation: vi.fn(),
  };
}

function serverAnnotation(overrides: Partial<BackendAnnotation> = {}): BackendAnnotation {
  return {
    id: "77",
    articleId: "50",
    quote: "highlighted text",
    note: "a note",
    locators: [
      {
        kind: "dom-range",
        startXPath: "/p[1]",
        startOffset: 0,
        endXPath: "/p[1]",
        endOffset: 16,
      },
    ],
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
    ...overrides,
  };
}

async function insertArticle(id: number, backendId: string, content: string | null) {
  await db.run("INSERT INTO articles (id, backend_id, url, content) VALUES (?, ?, ?, ?)", [
    id,
    backendId,
    `https://x/${id}`,
    content,
  ]);
}

describe("pullAnnotationsForArticle", () => {
  it("inserts server annotations locally with backend_id and mapped ranges", async () => {
    await insertArticle(50, "50", "<p>hi</p>");
    const backend = makeBackend({ "50": [serverAnnotation()] });

    const changed = await pullAnnotationsForArticle(db, backend, { id: 50, backend_id: "50" });

    expect(changed).toBe(true);
    const rows = await listAnnotations(db, 50);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(77); // wallabag: local id == server id
    expect(rows[0]?.backend_id).toBe("77");
    expect(rows[0]?.quote).toBe("highlighted text");
    expect(rows[0]?.text).toBe("a note");
    expect(rows[0]?.pending_op).toBeNull();
    expect(JSON.parse(rows[0]!.ranges_json)).toEqual([
      { start: "/p[1]", startOffset: 0, end: "/p[1]", endOffset: 16 },
    ]);
  });

  it("assigns autoincrement local ids for backends with non-integer ids and reuses them on re-pull", async () => {
    await insertArticle(3, "uuid-article", "<p>hi</p>");
    const backend = makeBackend(
      { "uuid-article": [serverAnnotation({ id: "anno-uuid", articleId: "uuid-article" })] },
      { localIdMatchesBackendId: false },
    );

    await pullAnnotationsForArticle(db, backend, { id: 3, backend_id: "uuid-article" });
    const first = await listAnnotations(db, 3);
    expect(first).toHaveLength(1);
    expect(first[0]?.id).toBeGreaterThan(0);
    expect(first[0]?.backend_id).toBe("anno-uuid");

    // Second pull must update the same row, not insert a duplicate.
    await pullAnnotationsForArticle(db, backend, { id: 3, backend_id: "uuid-article" });
    const second = await listAnnotations(db, 3);
    expect(second).toHaveLength(1);
    expect(second[0]?.id).toBe(first[0]?.id);
  });

  it("updates an existing row when the server copy changed", async () => {
    await insertArticle(50, "50", "<p>hi</p>");
    await upsertAnnotations(db, [
      {
        id: 77,
        backend_id: "77",
        article_id: 50,
        quote: "highlighted text",
        ranges_json: "[]",
        text: "old note",
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-01T00:00:00Z",
      },
    ]);
    const backend = makeBackend({
      "50": [serverAnnotation({ note: "edited on the web", updatedAt: "2026-06-02T00:00:00Z" })],
    });

    const changed = await pullAnnotationsForArticle(db, backend, { id: 50, backend_id: "50" });

    expect(changed).toBe(true);
    const rows = await listAnnotations(db, 50);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.text).toBe("edited on the web");
    expect(rows[0]?.updated_at).toBe("2026-06-02T00:00:00Z");
  });

  it("does not clobber rows with a pending local operation", async () => {
    await insertArticle(50, "50", "<p>hi</p>");
    await upsertAnnotations(db, [
      {
        id: 77,
        backend_id: "77",
        article_id: 50,
        quote: "highlighted text",
        ranges_json: "[]",
        text: "locally edited, not yet drained",
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-03T00:00:00Z",
        pending_op: "update",
      },
    ]);
    const backend = makeBackend({
      "50": [serverAnnotation({ note: "stale server note", updatedAt: "2026-06-02T00:00:00Z" })],
    });

    await pullAnnotationsForArticle(db, backend, { id: 50, backend_id: "50" });

    const rows = await listAnnotations(db, 50);
    expect(rows[0]?.text).toBe("locally edited, not yet drained");
    expect(rows[0]?.pending_op).toBe("update");
  });

  it("removes synced rows that disappeared from the server but keeps pending rows", async () => {
    await insertArticle(50, "50", "<p>hi</p>");
    await upsertAnnotations(db, [
      // Synced row deleted in the server web UI.
      {
        id: 77,
        backend_id: "77",
        article_id: 50,
        quote: "deleted elsewhere",
        ranges_json: "[]",
        text: null,
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-01T00:00:00Z",
      },
      // Local highlight not yet uploaded — must survive.
      {
        id: -1,
        backend_id: null,
        article_id: 50,
        quote: "created offline",
        ranges_json: "[]",
        text: null,
        created_at: "2026-06-04T00:00:00Z",
        updated_at: "2026-06-04T00:00:00Z",
        pending_op: "create",
      },
      // Locally deleted, awaiting drain — must survive (drainer purges it).
      {
        id: 88,
        backend_id: "88",
        article_id: 50,
        quote: "pending delete",
        ranges_json: "[]",
        text: null,
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-01T00:00:00Z",
        pending_op: "delete",
      },
    ]);
    const backend = makeBackend({ "50": [] });

    const changed = await pullAnnotationsForArticle(db, backend, { id: 50, backend_id: "50" });

    expect(changed).toBe(true);
    const rows = await listAnnotations(db, 50);
    expect(rows.map((r) => r.quote).sort()).toEqual(["created offline", "pending delete"]);
  });

  it("emits an annotations data event only when something changed", async () => {
    await insertArticle(50, "50", "<p>hi</p>");
    const backend = makeBackend({ "50": [serverAnnotation()] });
    const events: DataChangeEvent[] = [];
    const unsubscribe = dataEvents.subscribe((e) => events.push(e));

    await pullAnnotationsForArticle(db, backend, { id: 50, backend_id: "50" });
    expect(events).toEqual([{ kind: "annotations", articleId: 50 }]);

    // Second pull: server unchanged, no event.
    await pullAnnotationsForArticle(db, backend, { id: 50, backend_id: "50" });
    expect(events).toHaveLength(1);
    unsubscribe();
  });
});

describe("pullAnnotations", () => {
  it("pulls for articles with local content and skips the rest", async () => {
    await insertArticle(50, "50", "<p>read</p>");
    await insertArticle(51, "51", null);
    const backend = makeBackend({ "50": [serverAnnotation()], "51": [serverAnnotation()] });

    await pullAnnotations(db, backend);

    expect(backend.listCalls).toEqual(["50"]);
    expect(await listAnnotations(db, 50)).toHaveLength(1);
    expect(await listAnnotations(db, 51)).toHaveLength(0);
  });

  it("does nothing for backends without annotation support", async () => {
    await insertArticle(50, "50", "<p>read</p>");
    const backend = makeBackend({ "50": [serverAnnotation()] }, { annotations: false });

    await pullAnnotations(db, backend);

    expect(backend.listCalls).toEqual([]);
  });

  it("continues with remaining articles when one fetch fails", async () => {
    await insertArticle(50, "50", "<p>read</p>");
    await insertArticle(60, "60", "<p>read</p>");
    const backend = makeBackend({ "60": [serverAnnotation({ id: "90", articleId: "60" })] });
    const originalList = backend.listAnnotations.bind(backend);
    backend.listAnnotations = async (articleId) => {
      if (articleId === "50") throw new Error("boom");
      return originalList(articleId);
    };

    await pullAnnotations(db, backend);

    expect(await listAnnotations(db, 60)).toHaveLength(1);
  });
});
