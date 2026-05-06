import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { getDb } from "@/db";
import {
  rememberPending,
  markCached,
  markFailed,
  getImage,
  pickEvictionCandidates,
  deleteImage,
} from "./repo";

const CACHE_DIR = (FileSystem.cacheDirectory ?? "") + "wb_images/";

const DEFAULT_BUDGET_BYTES = 500 * 1024 * 1024; // 500 MB target cache size

let dirReady: Promise<void> | null = null;

async function ensureDir(): Promise<void> {
  if (Platform.OS === "web") return;
  if (!dirReady) {
    dirReady = (async () => {
      const info = await FileSystem.getInfoAsync(CACHE_DIR);
      if (!info.exists) {
        await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
      }
    })();
  }
  return dirReady;
}

function fileNameFor(src: string): string {
  let hash = 0;
  for (let i = 0; i < src.length; i++) {
    hash = (hash * 31 + src.charCodeAt(i)) | 0;
  }
  const ext = src.match(/\.([a-zA-Z0-9]+)(?:\?|#|$)/)?.[1] ?? "img";
  return `${Math.abs(hash).toString(36)}.${ext}`;
}

/**
 * On native: ensures `srcs` are cached locally, returning a Map of src → file://path
 * for any successfully cached entries.
 *
 * On web: returns an empty Map — the browser caches network images itself.
 */
export async function ensureCached(
  articleId: number,
  srcs: readonly string[],
): Promise<Map<string, string>> {
  if (Platform.OS === "web" || srcs.length === 0) return new Map();
  await ensureDir();
  const db = await getDb();

  const result = new Map<string, string>();

  await Promise.all(
    srcs.map(async (src) => {
      try {
        const existing = await getImage(db, articleId, src);
        if (existing?.status === "cached" && existing.local_path) {
          const info = await FileSystem.getInfoAsync(existing.local_path);
          if (info.exists) {
            result.set(src, existing.local_path);
            return;
          }
        }

        await rememberPending(db, articleId, src);
        const target = CACHE_DIR + fileNameFor(src);
        const dl = await FileSystem.downloadAsync(src, target);
        if (dl.status >= 200 && dl.status < 300) {
          const info = await FileSystem.getInfoAsync(dl.uri);
          const size = info.exists && "size" in info ? Number(info.size ?? 0) : 0;
          await markCached(db, articleId, src, dl.uri, size);
          result.set(src, dl.uri);
        } else {
          await markFailed(db, articleId, src);
        }
      } catch {
        try {
          await markFailed(db, articleId, src);
        } catch {
          // ignore
        }
      }
    }),
  );

  void evictIfNeeded(DEFAULT_BUDGET_BYTES).catch(() => {});

  return result;
}

/**
 * Build a lookup function the rewriter can use to resolve src → local file path.
 * Returns null lookups on web; returns DB-backed lookups on native.
 */
export async function buildLocalLookup(articleId: number): Promise<(src: string) => string | null> {
  if (Platform.OS === "web") return () => null;
  const db = await getDb();
  const rows = await db.all<{ src: string; local_path: string | null; status: string }>(
    "SELECT src, local_path, status FROM images WHERE article_id = ? AND status = 'cached'",
    [articleId],
  );
  const map = new Map(rows.map((r) => [r.src, r.local_path] as const));
  return (src: string) => map.get(src) ?? null;
}

async function evictIfNeeded(targetBytes: number): Promise<void> {
  const db = await getDb();
  const totalRow = await db.get<{ total: number | null }>(
    "SELECT SUM(size_bytes) as total FROM images WHERE status = 'cached'",
  );
  const total = totalRow?.total ?? 0;
  if (total <= targetBytes) return;
  const bytesToFree = total - targetBytes;
  const candidates = await pickEvictionCandidates(db, bytesToFree);
  for (const c of candidates) {
    if (c.local_path) {
      try {
        await FileSystem.deleteAsync(c.local_path, { idempotent: true });
      } catch {
        // ignore
      }
    }
    await deleteImage(db, c.article_id, c.src);
  }
}
