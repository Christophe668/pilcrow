import type { WallabagInfo } from "@/api/types";
import { proxiedFetch } from "@/api/http/web-proxy";

export async function fetchInfo(serverUrl: string): Promise<WallabagInfo> {
  // Use `proxiedFetch` so the web target routes through the Metro
  // dev proxy. Bare `fetch` would either CORS-fail against self-hosted
  // Wallabag or return a body the browser can't decode when the
  // upstream sets `Content-Encoding: gzip`.
  const res = await proxiedFetch(`${serverUrl}/api/info.json`);
  if (!res.ok) {
    throw new Error(`Server returned ${res.status} for /api/info.json`);
  }
  const j = (await res.json()) as Partial<WallabagInfo>;
  if (j.appname !== "wallabag") {
    throw new Error("This is not a wallabag instance");
  }
  return j as WallabagInfo;
}
