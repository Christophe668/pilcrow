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
  beginReadeckSignIn,
  pollReadeckSignIn,
  signInWallabag,
  getActiveBackendKind,
  clearActiveBackendKind,
} from "@/api/backend/auth";

beforeEach(() => {
  secure.clear();
  asyncMem.clear();
});

const SERVER = "https://rd.test";

describe("getActiveBackendKind", () => {
  it("defaults to wallabag for installs that have not picked a kind", async () => {
    expect(await getActiveBackendKind()).toBe("wallabag");
  });

  it("returns the stored kind when set", async () => {
    asyncMem.set("wb:backend_kind", "readeck");
    expect(await getActiveBackendKind()).toBe("readeck");
  });

  it("normalizes anything not 'readeck' to 'wallabag'", async () => {
    asyncMem.set("wb:backend_kind", "garbage");
    expect(await getActiveBackendKind()).toBe("wallabag");
  });
});

describe("clearActiveBackendKind", () => {
  it("removes the stored kind", async () => {
    asyncMem.set("wb:backend_kind", "readeck");
    await clearActiveBackendKind();
    expect(asyncMem.has("wb:backend_kind")).toBe(false);
  });
});

describe("signInWallabag", () => {
  it("posts password grant, persists tokens + creds, marks kind=wallabag", async () => {
    server.use(
      http.post("https://wb.test/oauth/v2/token", async ({ request }) => {
        const body = await request.text();
        expect(body).toContain("grant_type=password");
        expect(body).toContain("username=alice");
        return HttpResponse.json({
          access_token: "AT",
          refresh_token: "RT",
          expires_in: 3600,
          token_type: "bearer",
        });
      }),
    );
    await signInWallabag({
      kind: "wallabag",
      serverUrl: "https://wb.test",
      clientId: "cid",
      clientSecret: "cs",
      username: "alice",
      password: "secret",
    });
    expect(asyncMem.get("wb:server_url")).toBe("https://wb.test");
    expect(asyncMem.get("wb:backend_kind")).toBe("wallabag");
    expect(secure.get("wb_access_token")).toBe("AT");
    expect(secure.get("wb_client_id")).toBe("cid");
  });
});

describe("Readeck device-code sign-in", () => {
  it("registers a client, requests authorization, returns the user code", async () => {
    server.use(
      http.post(`${SERVER}/api/oauth/client`, () =>
        HttpResponse.json(
          {
            client_id: "urn:uuid:test",
            client_name: "Pilcrow",
            client_uri: "x",
            software_id: "pilcrow",
            software_version: "0.1.0",
            grant_types: ["urn:ietf:params:oauth:grant-type:device_code"],
            response_types: ["code"],
          },
          { status: 201 },
        ),
      ),
      http.post(`${SERVER}/api/oauth/device`, () =>
        HttpResponse.json({
          device_code: "DC",
          user_code: "ABCD-1234",
          verification_uri: `${SERVER}/device`,
          verification_uri_complete: `${SERVER}/device?user_code=ABCD-1234`,
          expires_in: 300,
          interval: 5,
        }),
      ),
    );
    const challenge = await beginReadeckSignIn({ kind: "readeck", serverUrl: SERVER });
    expect(challenge.userCode).toBe("ABCD-1234");
    expect(challenge.intervalSeconds).toBe(5);
    expect(challenge.clientId).toBe("urn:uuid:test");
  });

  it("polling returns 'pending' before the user approves", async () => {
    server.use(
      http.post(`${SERVER}/api/oauth/token`, () =>
        HttpResponse.json({ error: "authorization_pending" }, { status: 400 }),
      ),
    );
    const r = await pollReadeckSignIn({
      serverUrl: SERVER,
      clientId: "urn:uuid:test",
      deviceCode: "DC",
      userCode: "ABCD-1234",
      verificationUri: `${SERVER}/device`,
      verificationUriComplete: `${SERVER}/device?user_code=ABCD-1234`,
      intervalSeconds: 5,
      expiresAt: Date.now() + 300_000,
    });
    expect(r.status).toBe("pending");
    expect(asyncMem.has("wb:backend_kind")).toBe(false);
  });

  it("polling returns 'slow_down' and the caller should back off", async () => {
    server.use(
      http.post(`${SERVER}/api/oauth/token`, () =>
        HttpResponse.json({ error: "slow_down" }, { status: 400 }),
      ),
    );
    const r = await pollReadeckSignIn({
      serverUrl: SERVER,
      clientId: "urn:uuid:test",
      deviceCode: "DC",
      userCode: "ABCD-1234",
      verificationUri: `${SERVER}/device`,
      verificationUriComplete: `${SERVER}/device?user_code=ABCD-1234`,
      intervalSeconds: 5,
      expiresAt: Date.now() + 300_000,
    });
    expect(r.status).toBe("slow_down");
  });

  it("polling returns 'complete' once approved and persists token + kind", async () => {
    server.use(
      http.post(`${SERVER}/api/oauth/token`, () =>
        HttpResponse.json({
          id: "tok-1",
          access_token: "READECK-TOKEN",
          token_type: "Bearer",
          scope: "bookmarks:read bookmarks:write",
        }),
      ),
    );
    const r = await pollReadeckSignIn({
      serverUrl: SERVER,
      clientId: "urn:uuid:test",
      deviceCode: "DC",
      userCode: "ABCD-1234",
      verificationUri: `${SERVER}/device`,
      verificationUriComplete: `${SERVER}/device?user_code=ABCD-1234`,
      intervalSeconds: 5,
      expiresAt: Date.now() + 300_000,
    });
    expect(r.status).toBe("complete");
    expect(asyncMem.get("wb:server_url")).toBe(SERVER);
    expect(asyncMem.get("wb:backend_kind")).toBe("readeck");
    expect(secure.get("wb_access_token")).toBe("READECK-TOKEN");
  });
});
