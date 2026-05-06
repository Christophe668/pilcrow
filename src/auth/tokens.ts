import { secureGet, secureSet, secureClear } from "@/auth/storage";
import { refreshGrant } from "@/auth/oauth";
import type { TokenBundle } from "@/api/types";

const REFRESH_LEEWAY_MS = 60_000;
let inFlightRefresh: Promise<string> | null = null;

export async function applyTokenBundle(bundle: TokenBundle): Promise<void> {
  const expiresAt = Date.now() + bundle.expires_in * 1000;
  await secureSet("access_token", bundle.access_token);
  await secureSet("refresh_token", bundle.refresh_token);
  await secureSet("token_expires_at", String(expiresAt));
}

export async function getAccessToken(): Promise<string | null> {
  return secureGet("access_token");
}

export async function clearTokens(): Promise<void> {
  await secureClear();
}

async function readExpiresAt(): Promise<number | null> {
  const v = await secureGet("token_expires_at");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function ensureFreshToken(args: {
  serverUrl: string;
  clientId: string;
  clientSecret: string;
}): Promise<string> {
  const access = await getAccessToken();
  const expiresAt = await readExpiresAt();
  const needsRefresh = !access || expiresAt === null || expiresAt - Date.now() < REFRESH_LEEWAY_MS;
  if (!needsRefresh) return access!;

  if (!inFlightRefresh) {
    inFlightRefresh = (async () => {
      try {
        const refresh = await secureGet("refresh_token");
        if (!refresh) throw new Error("Missing refresh_token");
        const bundle = await refreshGrant({
          serverUrl: args.serverUrl,
          clientId: args.clientId,
          clientSecret: args.clientSecret,
          refreshToken: refresh,
        });
        await applyTokenBundle(bundle);
        return bundle.access_token;
      } finally {
        inFlightRefresh = null;
      }
    })();
  }
  return inFlightRefresh;
}
