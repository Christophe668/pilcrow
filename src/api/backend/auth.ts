/**
 * Unified sign-in entry point. Today supports two grant flows:
 *
 *  - Wallabag: OAuth password grant (single round-trip → access + refresh
 *    tokens stored in secure storage).
 *  - Readeck: OAuth 2.0 device-code flow (RFC 8628). The first step
 *    returns a user code + verification URL the UI should show; the
 *    second step polls until the user approves on the web.
 *
 * The auth state machine in `src/auth/state.ts` is the only caller —
 * UI screens bind to that store, not directly to the functions here.
 */

import { kvSet, kvRemove } from "@/lib/async-storage";
import { secureSet } from "@/auth/storage";
import { applyTokenBundle } from "@/auth/tokens";
import { passwordGrant } from "@/auth/oauth";
import {
  registerClient,
  authorizeDevice,
  pollDeviceCode,
  AuthorizationPendingError,
  SlowDownError,
} from "@/api/readeck/oauth";
import type { BackendKind } from "./types";

export type WallabagSignInRequest = {
  kind: "wallabag";
  serverUrl: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
};

export type ReadeckBeginRequest = {
  kind: "readeck";
  serverUrl: string;
  /** Optional: pilcrow's app version, threaded into the OAuth client_uri. */
  appVersion?: string;
};

export type DeviceCodeChallenge = {
  serverUrl: string;
  clientId: string;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  intervalSeconds: number;
  expiresAt: number;
};

/**
 * Wallabag's sign-in completes synchronously — the token is applied
 * and the active backend kind is recorded.
 */
export async function signInWallabag(req: WallabagSignInRequest): Promise<void> {
  const bundle = await passwordGrant({
    serverUrl: req.serverUrl,
    clientId: req.clientId,
    clientSecret: req.clientSecret,
    username: req.username,
    password: req.password,
  });
  await kvSet("server_url", req.serverUrl);
  await secureSet("client_id", req.clientId);
  await secureSet("client_secret", req.clientSecret);
  await secureSet("username", req.username);
  await applyTokenBundle(bundle);
  await kvSet("backend_kind", "wallabag");
}

/**
 * Readeck step 1: register pilcrow as an OAuth client (idempotent per
 * server) and request device authorization. Returns the user-facing
 * code + URL for the UI to display, plus the polling parameters.
 */
export async function beginReadeckSignIn(req: ReadeckBeginRequest): Promise<DeviceCodeChallenge> {
  const client = await registerClient({
    serverUrl: req.serverUrl,
    appVersion: req.appVersion ?? "0.1.0",
  });
  const auth = await authorizeDevice({
    serverUrl: req.serverUrl,
    clientId: client.client_id,
  });
  return {
    serverUrl: req.serverUrl,
    clientId: client.client_id,
    deviceCode: auth.device_code,
    userCode: auth.user_code,
    verificationUri: auth.verification_uri,
    verificationUriComplete: auth.verification_uri_complete,
    intervalSeconds: auth.interval,
    expiresAt: Date.now() + auth.expires_in * 1000,
  };
}

export type DevicePollResult =
  | { status: "pending" }
  | { status: "slow_down" }
  | { status: "complete" };

/**
 * Readeck step 2: poll the token endpoint once. Returns `pending` /
 * `slow_down` while the user hasn't approved on the web, or
 * `complete` once a token is issued (which is also persisted as the
 * active session). Callers should keep polling at the cadence
 * indicated by `intervalSeconds` from the challenge until status
 * flips, then stop.
 */
export async function pollReadeckSignIn(challenge: DeviceCodeChallenge): Promise<DevicePollResult> {
  try {
    const token = await pollDeviceCode({
      serverUrl: challenge.serverUrl,
      clientId: challenge.clientId,
      deviceCode: challenge.deviceCode,
    });
    // Token issued — persist and flip the active backend kind.
    await kvSet("server_url", challenge.serverUrl);
    await secureSet("client_id", challenge.clientId);
    // Readeck issues long-lived tokens; we still write a placeholder
    // expires_at to keep the existing tokens module happy, then mark
    // the kind so api/client.ts knows not to attempt a refresh dance.
    await secureSet("access_token", token.access_token);
    await kvSet("backend_kind", "readeck");
    return { status: "complete" };
  } catch (e) {
    if (e instanceof AuthorizationPendingError) return { status: "pending" };
    if (e instanceof SlowDownError) return { status: "slow_down" };
    throw e;
  }
}

/** Reads the active backend kind from storage; defaults to wallabag for back-compat. */
export async function getActiveBackendKind(): Promise<BackendKind> {
  // Read lazily to avoid pulling async-storage at module load.
  const { kvGet } = await import("@/lib/async-storage");
  const v = await kvGet("backend_kind");
  if (v === "readeck") return "readeck";
  return "wallabag";
}

/** Used during sign-out to wipe the kind alongside other state. */
export async function clearActiveBackendKind(): Promise<void> {
  await kvRemove("backend_kind");
}
