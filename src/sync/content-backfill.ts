import { Platform } from "react-native";
import { getDb } from "@/db";
import { getBackend } from "@/api/backend";
import { upsertArticleByBackendId } from "@/db/repos/articles";
import { extractImageSources } from "@/images/rewrite";
import { pullAnnotationsForArticle } from "./annotations-pull";
import { dataEvents } from "./events";

/**
 * Background content backfill.
 *
 * Sync deliberately keeps the article *list* fast: the initial sweep
 * stores metadata only, and Readeck's list API never includes bodies at
 * all. This module fills the gap afterwards so the whole library is
 * readable offline — it walks every row whose `content` is still NULL
 * and fetches the full article, unread-and-newest first (the articles
 * the user is most likely to open next).
 *
 * Design constraints:
 *  - Fire-and-forget: callers never await it on a user-visible path.
 *  - Single-flight: concurrent callers share one run.
 *  - Best-effort: a per-article failure is counted and skipped; a run
 *    of consecutive failures (device offline, server down) aborts the
 *    sweep instead of hammering the network. The next sync retries.
 *  - Only the `content` column is written. Flag fields (archived,
 *    starred, tags) are the sync engine's job — writing them here could
 *    stomp local edits waiting in the outbox.
 */

const CONCURRENCY = 3;
const MAX_CONSECUTIVE_FAILURES = 5;
/** Cap image prefetch to the newest unread articles so a huge first
 * backfill doesn't try to mirror years of archive images at once. */
const IMAGE_PREFETCH_ARTICLE_LIMIT = 100;
/** Refresh list UIs every N stored bodies instead of on each one. */
const EMIT_EVERY = 10;

export type BackfillResult = {
  fetched: number;
  failed: number;
  /** Rows the server had no body for either (e.g. Readeck still extracting). */
  skipped: number;
  aborted: boolean;
};

type PendingRow = { id: number; backend_id: string; is_archived: number };

let inFlight: Promise<BackfillResult> | null = null;

export function backfillMissingContent(): Promise<BackfillResult> {
  if (!inFlight) {
    inFlight = run().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function run(): Promise<BackfillResult> {
  const db = await getDb();
  const backend = getBackend();

  const rows = await db.all<PendingRow>(
    `SELECT id, backend_id, is_archived FROM articles
     WHERE content IS NULL AND backend_id IS NOT NULL
       AND (pending_op IS NULL OR pending_op <> 'delete')
     ORDER BY is_archived ASC, COALESCE(created_at, '') DESC`,
  );

  const result: BackfillResult = { fetched: 0, failed: 0, skipped: 0, aborted: false };
  if (rows.length === 0) return result;

  let next = 0;
  let consecutiveFailures = 0;
  let imagePrefetches = 0;

  const worker = async (): Promise<void> => {
    while (!result.aborted) {
      const index = next++;
      const row = rows[index];
      if (!row) return;
      try {
        const article = await backend.getArticle(row.backend_id);
        consecutiveFailures = 0;
        if (article.content === null) {
          result.skipped += 1;
          continue;
        }
        await upsertArticleByBackendId(db, {
          backend_id: row.backend_id,
          content: article.content,
        });
        result.fetched += 1;
        dataEvents.emit({ kind: "article", id: row.id });
        if (result.fetched % EMIT_EVERY === 0) dataEvents.emit({ kind: "articles" });

        // The row just became readable — bring its server annotations
        // along so highlights are there on first open. Best-effort like
        // the rest of the sweep: the next sync's pull covers a miss.
        if (backend.capabilities.annotations) {
          await pullAnnotationsForArticle(db, backend, {
            id: row.id,
            backend_id: row.backend_id,
          }).catch(() => {});
        }

        if (
          Platform.OS !== "web" &&
          row.is_archived === 0 &&
          imagePrefetches < IMAGE_PREFETCH_ARTICLE_LIMIT
        ) {
          imagePrefetches += 1;
          const srcs = extractImageSources(article.content);
          if (srcs.length > 0) {
            // Lazy import keeps expo-file-system out of the web bundle
            // and out of the unit-test module graph.
            const { ensureCached } = await import("@/images/cache");
            await ensureCached(row.id, srcs);
          }
        }
      } catch {
        result.failed += 1;
        consecutiveFailures += 1;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          result.aborted = true;
        }
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  if (result.fetched > 0) dataEvents.emit({ kind: "articles" });
  return result;
}
