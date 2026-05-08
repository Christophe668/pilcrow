/**
 * Readeck HTTP client. Bearer-token only; no refresh dance because
 * Readeck issues long-lived tokens by default. If the server returns
 * 401 the session is unrecoverable — the caller should sign out.
 */

import { proxiedFetch } from "@/api/http/web-proxy";

export type ReadeckRequestArgs = {
  serverUrl: string;
  accessToken: string;
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** When true, parse the response body as text (HTML article fetches). */
  expectText?: boolean;
};

export class ReadeckApiError extends Error {
  constructor(
    public status: number,
    public path: string,
    public bodyText: string,
  ) {
    super(`Readeck API ${status} ${path}`);
    this.name = "ReadeckApiError";
  }
}

export class ReadeckUnauthorizedError extends Error {
  constructor() {
    super("Readeck token rejected — please sign in again");
    this.name = "ReadeckUnauthorizedError";
  }
}

function buildUrl(serverUrl: string, path: string, query?: ReadeckRequestArgs["query"]): string {
  const url = new URL(serverUrl + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined) continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

/**
 * Internal: send a request and return the raw `Response`. Most callers
 * want `request<T>()` which parses JSON; the `Response` form is exposed
 * for endpoints that return non-JSON (article HTML) or where the caller
 * needs response headers (Total-Count for pagination).
 */
export async function rawRequest(args: ReadeckRequestArgs): Promise<Response> {
  const init: RequestInit = {
    method: args.method,
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      Accept: args.expectText ? "text/html" : "application/json",
      ...(args.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
  };
  if (args.body !== undefined) {
    init.body = JSON.stringify(args.body);
  }
  const res = await proxiedFetch(buildUrl(args.serverUrl, args.path, args.query), init);
  if (res.status === 401) {
    throw new ReadeckUnauthorizedError();
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ReadeckApiError(res.status, args.path, text);
  }
  return res;
}

export async function request<T>(args: ReadeckRequestArgs): Promise<T> {
  const res = await rawRequest(args);
  return (await res.json()) as T;
}

export async function requestText(args: ReadeckRequestArgs): Promise<string> {
  const res = await rawRequest({ ...args, expectText: true });
  return res.text();
}
