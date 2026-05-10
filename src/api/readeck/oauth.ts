import type {
  DeviceAuthorizationResponse,
  OAuthClientCreate,
  OAuthClientResponse,
  OAuthErrorBody,
  ReadeckTokenResponse,
} from "./types";

const DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

export class ReadeckOAuthError extends Error {
  constructor(
    public code: OAuthErrorBody["error"] | "http_error",
    public status: number,
    public description?: string,
  ) {
    super(description ?? code);
    this.name = "ReadeckOAuthError";
  }
}

/**
 * Sentinel returned by `pollDeviceCode` while the user has not yet
 * approved the device. The caller should wait `interval` seconds before
 * polling again.
 */
export class AuthorizationPendingError extends Error {
  constructor() {
    super("authorization_pending");
    this.name = "AuthorizationPendingError";
  }
}

/**
 * Sentinel returned by `pollDeviceCode` when the server asks the client
 * to slow down its polling. The caller should add `interval` seconds to
 * its polling cadence.
 */
export class SlowDownError extends Error {
  constructor() {
    super("slow_down");
    this.name = "SlowDownError";
  }
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let parsed: OAuthErrorBody | undefined;
    try {
      parsed = text ? (JSON.parse(text) as OAuthErrorBody) : undefined;
    } catch {
      // Non-JSON error body — fall through with raw text.
    }
    if (parsed?.error === "authorization_pending") throw new AuthorizationPendingError();
    if (parsed?.error === "slow_down") throw new SlowDownError();
    throw new ReadeckOAuthError(
      parsed?.error ?? "http_error",
      res.status,
      parsed?.error_description ?? text,
    );
  }
  return (await res.json()) as T;
}

/**
 * Registers pilcrow as a public OAuth client on the given Readeck server,
 * per RFC 7591. Each install registers itself once per server; the
 * resulting `client_id` is stable and should be cached in secure storage
 * keyed by server URL.
 */
export async function registerClient(args: {
  serverUrl: string;
  appVersion: string;
}): Promise<OAuthClientResponse> {
  const body: OAuthClientCreate = {
    client_name: "Pilcrow",
    client_uri: "https://github.com/Christophe668/pilcrow",
    software_id: "pilcrow",
    software_version: args.appVersion,
    grant_types: [DEVICE_CODE_GRANT],
    token_endpoint_auth_method: "none",
  };
  return postJson<OAuthClientResponse>(`${args.serverUrl}/api/oauth/client`, body);
}

/**
 * Initiates the device authorization flow. Returns the user-facing code
 * and verification URL the UI should show, plus the device code and
 * polling interval the client uses to fetch a token.
 */
export async function authorizeDevice(args: {
  serverUrl: string;
  clientId: string;
  scope?: string;
}): Promise<DeviceAuthorizationResponse> {
  return postJson<DeviceAuthorizationResponse>(`${args.serverUrl}/api/oauth/device`, {
    client_id: args.clientId,
    scope: args.scope ?? "profile:read bookmarks:read bookmarks:write",
  });
}

/**
 * Polls the token endpoint with the device code. Throws
 * `AuthorizationPendingError` (the user hasn't approved yet) or
 * `SlowDownError` (poll less aggressively) — callers handle these as
 * soft retries. Any other failure is fatal.
 */
export async function pollDeviceCode(args: {
  serverUrl: string;
  clientId: string;
  deviceCode: string;
}): Promise<ReadeckTokenResponse> {
  return postJson<ReadeckTokenResponse>(`${args.serverUrl}/api/oauth/token`, {
    grant_type: DEVICE_CODE_GRANT,
    client_id: args.clientId,
    device_code: args.deviceCode,
  });
}

/**
 * Revokes a previously-issued access token. Used for sign-out.
 * The endpoint requires the token to be revoked to authenticate the
 * request itself.
 */
export async function revokeToken(args: { serverUrl: string; accessToken: string }): Promise<void> {
  const res = await fetch(`${args.serverUrl}/api/oauth/revoke`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token: args.accessToken }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ReadeckOAuthError("http_error", res.status, text);
  }
}
