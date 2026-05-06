import type { DbDriver } from "./driver";
import { runMigrations } from "./migrations";

let cached: Promise<DbDriver> | null = null;

async function makeDriver(): Promise<DbDriver> {
  // Both web and native go through expo-sqlite. The web shim is wasm-backed
  // (SDK 52+). If it crashes the way expo-secure-store did, we'll route web
  // through a sql.js wrapper here. We'll cross that bridge when we hit it.
  const { createExpoSqliteDriver } = await import("./driver-expo");
  return createExpoSqliteDriver("wallabag.db");
}

export async function getDb(): Promise<DbDriver> {
  if (!cached) {
    cached = (async () => {
      const driver = await makeDriver();
      await runMigrations(driver);
      return driver;
    })();
  }
  return cached;
}

export async function resetDb(): Promise<void> {
  if (cached) {
    const d = await cached;
    await d.close();
    cached = null;
  }
}

export function setDbForTesting(driver: DbDriver | null): void {
  cached = driver ? Promise.resolve(driver) : null;
}

export async function clearAllData(): Promise<void> {
  if (!cached) return;
  const driver = await cached;
  await driver.transaction(async (tx) => {
    await tx.exec(`
      DELETE FROM article_tags;
      DELETE FROM annotations;
      DELETE FROM tags;
      DELETE FROM articles;
      DELETE FROM outbox;
      DELETE FROM sync_state;
    `);
  });
}
