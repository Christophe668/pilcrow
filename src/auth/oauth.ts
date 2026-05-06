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
  const form = new URLSearchParams(body);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  if (!res.ok) {
    let code: string | undefined;
    try {
      const j = (await res.json()) as { error?: unknown };
      code = typeof j?.error === "string" ? j.error : undefined;
    } catch {
      // body wasn't JSON; ignore
    }
    if (res.status === 400 && code === "invalid_grant") {
      throw new InvalidCredentialsError();
    }
    throw new OAuthError(res.status, code, `Token endpoint returned ${res.status}`);
  }
  return (await res.json()) as TokenBundle;
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
