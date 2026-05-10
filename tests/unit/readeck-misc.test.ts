import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../src/test/msw-server";
import { listLabels } from "@/api/readeck/labels";
import { syncList } from "@/api/readeck/sync";
import {
  listAnnotations,
  createAnnotation,
  updateAnnotation,
  deleteAnnotation,
} from "@/api/readeck/annotations";

const SERVER = "https://rd.test";
const AUTH = { serverUrl: SERVER, accessToken: "TOKEN" };

describe("listLabels", () => {
  it("returns the bare labels array", async () => {
    server.use(
      http.get(`${SERVER}/api/bookmarks/labels`, () =>
        HttpResponse.json([
          {
            name: "go",
            count: 3,
            href: `${SERVER}/api/bookmarks/labels?name=go`,
            href_bookmarks: `${SERVER}/api/bookmarks?labels=go`,
          },
        ]),
      ),
    );
    const r = await listLabels(AUTH);
    expect(r).toEqual([expect.objectContaining({ name: "go", count: 3 })]);
  });
});

describe("syncList", () => {
  it("passes the since parameter through", async () => {
    server.use(
      http.get(`${SERVER}/api/bookmarks/sync`, ({ request }) => {
        expect(new URL(request.url).searchParams.get("since")).toBe("2026-01-01T00:00:00Z");
        return HttpResponse.json([
          { id: "a", time: "2026-01-02T00:00:00Z", type: "update" },
          { id: "b", time: "2026-01-02T01:00:00Z", type: "delete" },
        ]);
      }),
    );
    const r = await syncList(AUTH, { since: "2026-01-01T00:00:00Z" });
    expect(r).toHaveLength(2);
    expect(r[1]?.type).toBe("delete");
  });

  it("works without a since parameter (full bootstrap)", async () => {
    server.use(
      http.get(`${SERVER}/api/bookmarks/sync`, ({ request }) => {
        expect(new URL(request.url).searchParams.get("since")).toBeNull();
        return HttpResponse.json([]);
      }),
    );
    const r = await syncList(AUTH);
    expect(r).toEqual([]);
  });
});

describe("annotations CRUD", () => {
  it("listAnnotations hits the per-bookmark endpoint", async () => {
    server.use(
      http.get(`${SERVER}/api/bookmarks/:id/annotations`, ({ params }) => {
        expect(params["id"]).toBe("bk1");
        return HttpResponse.json([
          {
            id: "an1",
            text: "highlighted",
            color: "yellow",
            note: "",
            created: "2026-01-01T00:00:00Z",
            start_selector: "/article/p[1]",
            start_offset: 0,
            end_selector: "/article/p[1]",
            end_offset: 11,
          },
        ]);
      }),
    );
    const r = await listAnnotations(AUTH, "bk1");
    expect(r[0]?.color).toBe("yellow");
  });

  it("createAnnotation POSTs the locator and returns the new annotation", async () => {
    server.use(
      http.post(`${SERVER}/api/bookmarks/:id/annotations`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body).toMatchObject({
          start_selector: "/p[1]",
          start_offset: 0,
          end_selector: "/p[1]",
          end_offset: 5,
          color: "green",
        });
        return HttpResponse.json({
          id: "newid",
          text: "Hello",
          color: "green",
          note: "",
          created: "2026-01-01T00:00:00Z",
          start_selector: "/p[1]",
          start_offset: 0,
          end_selector: "/p[1]",
          end_offset: 5,
        });
      }),
    );
    const r = await createAnnotation(AUTH, "bk1", {
      start_selector: "/p[1]",
      start_offset: 0,
      end_selector: "/p[1]",
      end_offset: 5,
      color: "green",
    });
    expect(r.id).toBe("newid");
  });

  it("updateAnnotation PATCHes color/note", async () => {
    server.use(
      http.patch(`${SERVER}/api/bookmarks/:bkId/annotations/:anId`, async ({ request, params }) => {
        expect(params["bkId"]).toBe("bk1");
        expect(params["anId"]).toBe("an1");
        const body = (await request.json()) as Record<string, unknown>;
        expect(body).toEqual({ note: "interesting" });
        return HttpResponse.json({
          id: "an1",
          text: "x",
          color: "yellow",
          note: "interesting",
          created: "2026-01-01T00:00:00Z",
          start_selector: "",
          start_offset: 0,
          end_selector: "",
          end_offset: 0,
        });
      }),
    );
    const r = await updateAnnotation(AUTH, "bk1", "an1", { note: "interesting" });
    expect(r.note).toBe("interesting");
  });

  it("deleteAnnotation DELETEs the right URL", async () => {
    server.use(
      http.delete(`${SERVER}/api/bookmarks/:bkId/annotations/:anId`, ({ params }) => {
        expect(params["bkId"]).toBe("bk1");
        expect(params["anId"]).toBe("an1");
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await expect(deleteAnnotation(AUTH, "bk1", "an1")).resolves.toBeUndefined();
  });
});
