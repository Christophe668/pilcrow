import type { DbDriver } from "./driver";

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
      // Migrations will be wired in Task 3 (runMigrations(driver)).
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
