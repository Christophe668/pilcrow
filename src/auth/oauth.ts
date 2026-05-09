import type { TokenBundle } from "@/api/types";

export class InvalidCredentialsError extends Error {
  constructor() {
    super("Invalid credentials");
    this.name = "InvalidCredentialsError";
  }
}

export class OAuthError extends Error {
  constructor(
    public status: number,
    public code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "OAuthError";
  }
}

async function tokenRequest(serverUrl: string, body: Record<string, string>): Promise<TokenBundle> {
  const url = `${serverUrl}/oauth/v2/token`;
  // Serialize manually instead of passing a URLSearchParams object as the body.
  // React Native's fetch (Hermes) ships an incomplete URLSearchParams whose
  // `toString()` doesn't always round-trip — on some Android runtimes the body
  // arrives as `[object Object]`, the server sees no `grant_type` field, and
  // returns `unsupported_grant_type`. Encoding to a plain string avoids that.
  const form = encodeForm(body);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: form,
  });
  if (!res.ok) {
    // Read the raw body once, then try to parse — Wallabag can return either
    // a JSON envelope `{error, error_description}` or, in some misconfigured
    // setups, an HTML error page. Surface whatever we can to the caller.
    const raw = await res.text().catch(() => "");
    let code: string | undefined;
    let description: string | undefined;
    try {
      const j = JSON.parse(raw) as { error?: unknown; error_description?: unknown };
      if (typeof j?.error === "string") code = j.error;
      if (typeof j?.error_description === "string") description = j.error_description;
    } catch {
      // body wasn't JSON; keep raw for the fallback message
    }
    if (res.status === 400 && code === "invalid_grant") {
      throw new InvalidCredentialsError();
    }
    const friendly = friendlyOAuthMessage(code, description, res.status, raw);
    throw new OAuthError(res.status, code, friendly);
  }
  return (await res.json()) as TokenBundle;
}

function encodeForm(body: Record<string, string>): string {
  return Object.entries(body)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

function friendlyOAuthMessage(
  code: string | undefined,
  description: string | undefined,
  status: number,
  raw: string,
): string {
  // Prefer Wallabag's own error_description when present — it's the most
  // accurate hint ("The client credentials are invalid", etc.).
  if (description) return description;
  switch (code) {
    case "invalid_client":
      return "Invalid client ID or secret";
    case "invalid_grant":
      return "Invalid username or password";
    case "unsupported_grant_type":
      return "Server does not support password grant";
    case "invalid_request":
      return "Malformed token request";
    case "invalid_scope":
      return "Requested scope is not allowed";
  }
  // No structured error — show a short snippet of the raw body so the user
  // can see whether they hit a login page, a proxy error, etc.
  const snippet = raw.trim().slice(0, 120);
  return snippet
    ? `Token endpoint returned ${status}: ${snippet}`
    : `Token endpoint returned ${status}`;
}

export async function passwordGrant(args: {
  serverUrl: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
}): Promise<TokenBundle> {
  return tokenRequest(args.serverUrl, {
    grant_type: "password",
    client_id: args.clientId,
    client_secret: args.clientSecret,
    username: args.username,
    password: args.password,
  });
}

export async function refreshGrant(args: {
  serverUrl: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<TokenBundle> {
  return tokenRequest(args.serverUrl, {
    grant_type: "refresh_token",
    client_id: args.clientId,
    client_secret: args.clientSecret,
    refresh_token: args.refreshToken,
  });
}
