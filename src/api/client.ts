import { secureGet } from "@/auth/storage";
import { ensureFreshToken } from "@/auth/tokens";
import { kvGet } from "@/lib/async-storage";

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
  return fetch(buildUrl(args.serverUrl, args.path, args.query), init);
}

export async function request<T>(args: RequestArgs): Promise<T> {
  const { clientId, clientSecret } = await readClientCreds();
  let token = await ensureFreshToken({
    serverUrl: args.serverUrl,
    clientId,
    clientSecret,
  });
  let res = await send(args, token);
  if (res.status === 401) {
    token = await ensureFreshToken({
      serverUrl: args.serverUrl,
      clientId,
      clientSecret,
      force: true,
    });
    res = await send(args, token);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(res.status, args.path, text);
  }
  return (await res.json()) as T;
}

export async function authedRequest<T>(args: Omit<RequestArgs, "serverUrl">): Promise<T> {
  const serverUrl = await kvGet("server_url");
  if (!serverUrl) throw new Error("No server URL — sign in first");
  return request<T>({ ...args, serverUrl });
}
