import type { WallabagInfo } from "@/api/types";

export async function fetchInfo(serverUrl: string): Promise<WallabagInfo> {
  const res = await fetch(`${serverUrl}/api/info.json`);
  if (!res.ok) {
    throw new Error(`Server returned ${res.status} for /api/info.json`);
  }
  const j = (await res.json()) as Partial<WallabagInfo>;
  if (j.appname !== "wallabag") {
    throw new Error("This is not a wallabag instance");
  }
  return j as WallabagInfo;
}
