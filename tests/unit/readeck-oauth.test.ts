import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../src/test/msw-server";
import {
  registerClient,
  authorizeDevice,
  pollDeviceCode,
  revokeToken,
  AuthorizationPendingError,
  SlowDownError,
} from "@/api/readeck/oauth";

const SERVER = "https://rd.test";

describe("registerClient", () => {
  it("posts pilcrow's client metadata and returns the issued client_id", async () => {
    server.use(
      http.post(`${SERVER}/api/oauth/client`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body).toMatchObject({
          client_name: "Pilcrow",
          software_id: "pilcrow",
          software_version: "0.1.0",
          token_endpoint_auth_method: "none",
        });
        expect(body.grant_types).toContain("urn:ietf:params:oauth:grant-type:device_code");
        return HttpResponse.json(
          {
            client_id: "urn:uuid:test-client",
            client_name: "Pilcrow",
            client_uri: body.client_uri,
            software_id: "pilcrow",
            software_version: "0.1.0",
            grant_types: ["urn:ietf:params:oauth:grant-type:device_code"],
            response_types: ["code"],
          },
          { status: 201 },
        );
      }),
    );
    const r = await registerClient({ serverUrl: SERVER, appVersion: "0.1.0" });
    expect(r.client_id).toBe("urn:uuid:test-client");
  });

  it("surfaces server errors with code + description", async () => {
    server.use(
      http.post(`${SERVER}/api/oauth/client`, () =>
        HttpResponse.json(
          { error: "invalid_client_metadata", error_description: "client_uri must be HTTPS" },
          { status: 400 },
        ),
      ),
    );
    await expect(registerClient({ serverUrl: SERVER, appVersion: "0.1.0" })).rejects.toMatchObject({
      name: "ReadeckOAuthError",
      code: "invalid_client_metadata",
      status: 400,
    });
  });
});

describe("authorizeDevice", () => {
  it("returns the user code, verification URL, device code, and interval", async () => {
    server.use(
      http.post(`${SERVER}/api/oauth/device`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body).toMatchObject({
          client_id: "urn:uuid:test-client",
          scope: "profile:read bookmarks:read bookmarks:write",
        });
        return HttpResponse.json({
          device_code: "DEVICE-CODE",
          user_code: "ABCD-1234",
          verification_uri: `${SERVER}/device`,
          verification_uri_complete: `${SERVER}/device?user_code=ABCD-1234`,
          expires_in: 300,
          interval: 5,
        });
      }),
    );
    const r = await authorizeDevice({ serverUrl: SERVER, clientId: "urn:uuid:test-client" });
    expect(r.user_code).toBe("ABCD-1234");
    expect(r.interval).toBe(5);
  });
});

describe("pollDeviceCode", () => {
  it("throws AuthorizationPendingError when the user hasn't approved yet", async () => {
    server.use(
      http.post(`${SERVER}/api/oauth/token`, () =>
        HttpResponse.json({ error: "authorization_pending" }, { status: 400 }),
      ),
    );
    await expect(
      pollDeviceCode({ serverUrl: SERVER, clientId: "c", deviceCode: "d" }),
    ).rejects.toBeInstanceOf(AuthorizationPendingError);
  });

  it("throws SlowDownError when the server asks the client to back off", async () => {
    server.use(
      http.post(`${SERVER}/api/oauth/token`, () =>
        HttpResponse.json({ error: "slow_down" }, { status: 400 }),
      ),
    );
    await expect(
      pollDeviceCode({ serverUrl: SERVER, clientId: "c", deviceCode: "d" }),
    ).rejects.toBeInstanceOf(SlowDownError);
  });

  it("returns the access_token bundle on success", async () => {
    server.use(
      http.post(`${SERVER}/api/oauth/token`, () =>
        HttpResponse.json({
          id: "tok-1",
          access_token: "ACCESS",
          token_type: "Bearer",
          scope: "bookmarks:read",
        }),
      ),
    );
    const r = await pollDeviceCode({ serverUrl: SERVER, clientId: "c", deviceCode: "d" });
    expect(r.access_token).toBe("ACCESS");
  });

  it("surfaces fatal OAuth errors (expired token, etc.) as ReadeckOAuthError", async () => {
    server.use(
      http.post(`${SERVER}/api/oauth/token`, () =>
        HttpResponse.json(
          { error: "expired_token", error_description: "device code expired" },
          { status: 400 },
        ),
      ),
    );
    await expect(
      pollDeviceCode({ serverUrl: SERVER, clientId: "c", deviceCode: "d" }),
    ).rejects.toMatchObject({
      name: "ReadeckOAuthError",
      code: "expired_token",
    });
  });
});

describe("revokeToken", () => {
  it("posts the token to /oauth/revoke with bearer auth", async () => {
    server.use(
      http.post(`${SERVER}/api/oauth/revoke`, ({ request }) => {
        expect(request.headers.get("authorization")).toBe("Bearer TOKEN");
        return new HttpResponse(null, { status: 200 });
      }),
    );
    await expect(revokeToken({ serverUrl: SERVER, accessToken: "TOKEN" })).resolves.toBeUndefined();
  });
});
