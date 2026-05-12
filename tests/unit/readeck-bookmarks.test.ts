import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../src/test/msw-server";
import {
  listBookmarks,
  getBookmark,
  getBookmarkArticle,
  createBookmark,
  patchBookmark,
  deleteBookmark,
  pollBookmarkLoaded,
} from "@/api/readeck/bookmarks";
import { ReadeckUnauthorizedError } from "@/api/readeck/client";

const SERVER = "https://rd.test";
const AUTH = { serverUrl: SERVER, accessToken: "TOKEN" };

describe("listBookmarks", () => {
  it("sends bearer auth and surfaces Total-Count + Current-Page headers", async () => {
    server.use(
      http.get(`${SERVER}/api/bookmarks`, ({ request }) => {
        expect(request.headers.get("authorization")).toBe("Bearer TOKEN");
        const u = new URL(request.url);
        expect(u.searchParams.get("limit")).toBe("50");
        expect(u.searchParams.get("offset")).toBe("0");
        return HttpResponse.json([{ id: "abc", title: "Hello" }] as unknown[], {
          headers: { "Total-Count": "42", "Current-Page": "1" },
        });
      }),
    );
    const r = await listBookmarks(AUTH);
    expect(r.totalCount).toBe(42);
    expect(r.currentPage).toBe(1);
    expect(r.items).toHaveLength(1);
  });

  it("translates page>1 into the right offset", async () => {
    server.use(
      http.get(`${SERVER}/api/bookmarks`, ({ request }) => {
        const u = new URL(request.url);
        expect(u.searchParams.get("limit")).toBe("25");
        expect(u.searchParams.get("offset")).toBe("50");
        return HttpResponse.json([], { headers: { "Total-Count": "0" } });
      }),
    );
    await listBookmarks(AUTH, { page: 3, limit: 25 });
  });

  it("throws ReadeckUnauthorizedError on 401 so the auth gate can sign out", async () => {
    server.use(http.get(`${SERVER}/api/bookmarks`, () => HttpResponse.json({}, { status: 401 })));
    await expect(listBookmarks(AUTH)).rejects.toBeInstanceOf(ReadeckUnauthorizedError);
  });
});

describe("getBookmark", () => {
  it("URL-encodes the id and returns the parsed bookmark", async () => {
    server.use(
      http.get(`${SERVER}/api/bookmarks/:id`, ({ params }) => {
        expect(params["id"]).toBe("a/b");
        return HttpResponse.json({ id: "a/b", title: "T" });
      }),
    );
    const r = await getBookmark(AUTH, "a/b");
    expect(r.title).toBe("T");
  });
});

describe("getBookmarkArticle", () => {
  it("requests text/html and returns the body as a string", async () => {
    server.use(
      http.get(`${SERVER}/api/bookmarks/:id/article`, ({ request }) => {
        expect(request.headers.get("accept")).toBe("text/html");
        return new HttpResponse("<article><p>hi</p></article>", {
          headers: { "Content-Type": "text/html" },
        });
      }),
    );
    const html = await getBookmarkArticle(AUTH, "abc");
    expect(html).toContain("<p>hi</p>");
  });
});

describe("createBookmark", () => {
  it("returns the id from the Bookmark-Id response header", async () => {
    server.use(
      http.post(`${SERVER}/api/bookmarks`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body).toEqual({ url: "https://x.com", labels: ["a"] });
        return new HttpResponse(null, {
          status: 202,
          headers: { "Bookmark-Id": "newid", Location: `${SERVER}/api/bookmarks/newid` },
        });
      }),
    );
    const r = await createBookmark(AUTH, { url: "https://x.com", labels: ["a"] });
    expect(r.id).toBe("newid");
  });

  it("throws when the server omits the Bookmark-Id header", async () => {
    server.use(http.post(`${SERVER}/api/bookmarks`, () => new HttpResponse(null, { status: 202 })));
    await expect(createBookmark(AUTH, { url: "https://x.com" })).rejects.toThrow(/Bookmark-Id/);
  });
});

describe("patchBookmark + deleteBookmark", () => {
  it("PATCHes with the supplied body", async () => {
    server.use(
      http.patch(`${SERVER}/api/bookmarks/:id`, async ({ request, params }) => {
        expect(params["id"]).toBe("xyz");
        const body = (await request.json()) as Record<string, unknown>;
        expect(body).toEqual({ is_archived: true, add_labels: ["read"] });
        return HttpResponse.json({
          id: "xyz",
          href: `${SERVER}/api/bookmarks/xyz`,
          is_archived: true,
          labels: ["read"],
          updated: "2026-01-01T00:00:00Z",
        });
      }),
    );
    const r = await patchBookmark(AUTH, "xyz", { is_archived: true, add_labels: ["read"] });
    expect(r.is_archived).toBe(true);
  });

  it("DELETEs the bookmark", async () => {
    server.use(
      http.delete(`${SERVER}/api/bookmarks/:id`, () => new HttpResponse(null, { status: 204 })),
    );
    await expect(deleteBookmark(AUTH, "xyz")).resolves.toBeUndefined();
  });
});

describe("pollBookmarkLoaded", () => {
  it("returns once `loaded: true` and stops polling", async () => {
    let calls = 0;
    server.use(
      http.get(`${SERVER}/api/bookmarks/:id`, () => {
        calls += 1;
        return HttpResponse.json({ id: "x", loaded: calls >= 3, title: "" });
      }),
    );
    const r = await pollBookmarkLoaded(AUTH, "x", { intervalMs: 1, timeoutMs: 1000 });
    expect(r.loaded).toBe(true);
    expect(calls).toBe(3);
  });

  it("throws if the bookmark stays loading past the timeout", async () => {
    server.use(
      http.get(`${SERVER}/api/bookmarks/:id`, () =>
        HttpResponse.json({ id: "x", loaded: false, title: "" }),
      ),
    );
    await expect(pollBookmarkLoaded(AUTH, "x", { intervalMs: 5, timeoutMs: 30 })).rejects.toThrow(
      /did not finish loading/,
    );
  });
});
