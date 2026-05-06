import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../src/test/msw-server";
import { passwordGrant, refreshGrant } from "@/auth/oauth";

describe("passwordGrant", () => {
  it("posts grant_type=password and returns the token bundle", async () => {
    server.use(
      http.post("https://wb.test/oauth/v2/token", async ({ request }) => {
        const fd = (await request.formData()) as unknown as {
          entries(): IterableIterator<[string, string]>;
        };
        const body = Object.fromEntries(fd.entries());
        expect(body).toEqual({
          grant_type: "password",
          client_id: "cid",
          client_secret: "cs",
          username: "u",
          password: "p",
        });
        return HttpResponse.json({
          access_token: "at",
          refresh_token: "rt",
          expires_in: 3600,
          token_type: "bearer",
        });
      }),
    );
    const r = await passwordGrant({
      serverUrl: "https://wb.test",
      clientId: "cid",
      clientSecret: "cs",
      username: "u",
      password: "p",
    });
    expect(r.access_token).toBe("at");
    expect(r.refresh_token).toBe("rt");
    expect(r.expires_in).toBe(3600);
  });

  it("throws InvalidCredentials on 400 invalid_grant", async () => {
    server.use(
      http.post("https://wb.test/oauth/v2/token", () =>
        HttpResponse.json({ error: "invalid_grant" }, { status: 400 }),
      ),
    );
    await expect(
      passwordGrant({
        serverUrl: "https://wb.test",
        clientId: "cid",
        clientSecret: "cs",
        username: "u",
        password: "p",
      }),
    ).rejects.toThrow(/credentials/i);
  });
});

describe("refreshGrant", () => {
  it("posts grant_type=refresh_token and returns the new bundle", async () => {
    server.use(
      http.post("https://wb.test/oauth/v2/token", async ({ request }) => {
        const fd = (await request.formData()) as unknown as {
          entries(): IterableIterator<[string, string]>;
        };
        const body = Object.fromEntries(fd.entries());
        expect(body.grant_type).toBe("refresh_token");
        expect(body.refresh_token).toBe("rt-old");
        return HttpResponse.json({
          access_token: "at-new",
          refresh_token: "rt-new",
          expires_in: 3600,
          token_type: "bearer",
        });
      }),
    );
    const r = await refreshGrant({
      serverUrl: "https://wb.test",
      clientId: "cid",
      clientSecret: "cs",
      refreshToken: "rt-old",
    });
    expect(r.access_token).toBe("at-new");
  });
});
