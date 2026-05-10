import { secureGet } from "@/auth/storage";
import { ensureFreshToken } from "@/auth/tokens";
import { signOut } from "@/auth/state";
import { InvalidCredentialsError } from "@/auth/oauth";
import { kvGet } from "@/lib/async-storage";
import { proxiedFetch } from "@/api/http/web-proxy";

export type RequestArgs = {
  serverUrl: string;
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public path: string,
    public bodyText: string,
  ) {
    super(`API ${status} ${path}`);
    this.name = "ApiError";
  }
}

/**
 * Thrown when the access token can't be refreshed because the refresh
 * token is no longer valid (server returned `invalid_grant`). The session
 * is unrecoverable — the caller should let the auth gate route the user
 * back to sign-in. The api client signs out before throwing so the
 * `authStore` flips to "unauthenticated" and the route guard kicks in.
 */
export class SessionExpiredError extends Error {
  constructor() {
    super("Session expired — please sign in again");
    this.name = "SessionExpiredError";
  }
}

async function readClientCreds() {
  const clientId = await secureGet("client_id");
  const clientSecret = await secureGet("client_secret");
  if (!clientId || !clientSecret) {
    throw new Error("Client credentials missing — re-authenticate");
  }
  return { clientId, clientSecret };
}

function buildUrl(serverUrl: string, path: string, query?: RequestArgs["query"]) {
  const url = new URL(serverUrl + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function send(args: RequestArgs, token: string): Promise<Response> {
  const init: RequestInit = {
    method: args.method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(args.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
  };
  if (args.body !== undefined) {
    init.body = JSON.stringify(args.body);
  }
  return proxiedFetch(buildUrl(args.serverUrl, args.path, args.query), init);
}

export async function request<T>(args: RequestArgs): Promise<T> {
  const { clientId, clientSecret } = await readClientCreds();
  let token: string;
  try {
    token = await ensureFreshToken({
      serverUrl: args.serverUrl,
      clientId,
      clientSecret,
    });
  } catch (e) {
    throw await mapTokenError(e);
  }
  let res = await send(args, token);
  if (res.status === 401) {
    try {
      token = await ensureFreshToken({
        serverUrl: args.serverUrl,
        clientId,
        clientSecret,
        force: true,
      });
    } catch (e) {
      throw await mapTokenError(e);
    }
    res = await send(args, token);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(res.status, args.path, text);
  }
  return (await res.json()) as T;
}

/**
 * If the token endpoint reports the refresh token is no longer valid, the
 * session is unrecoverable. Sign out so the auth gate routes the user
 * back to login, and surface a structured error so callers can show a
 * friendly message instead of "invalid credentials" mid-action.
 */
async function mapTokenError(e: unknown): Promise<unknown> {
  if (e instanceof InvalidCredentialsError) {
    await signOut().catch(() => undefined);
    return new SessionExpiredError();
  }
  return e;
}

export async function authedRequest<T>(args: Omit<RequestArgs, "serverUrl">): Promise<T> {
  const serverUrl = await kvGet("server_url");
  if (!serverUrl) throw new Error("No server URL — sign in first");
  return request<T>({ ...args, serverUrl });
}
