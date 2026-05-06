import type { DbDriver } from "../driver";
import sql001 from "./001_initial.sql";
import sql002 from "./002_fts.sql";
import sql003 from "./003_images.sql";

type Migration = {
  version: number;
  sql: string;
  name: string;
  requiresFts?: boolean;
};

const MIGRATIONS: readonly Migration[] = [
  { version: 1, sql: sql001 as unknown as string, name: "001_initial" },
  { version: 2, sql: sql002 as unknown as string, name: "002_fts", requiresFts: true },
  { version: 3, sql: sql003 as unknown as string, name: "003_images" },
];

async function ensureRegistry(db: DbDriver): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);
}

async function hasFts5(db: DbDriver): Promise<boolean> {
  try {
    // Probe by attempting to create + drop a temp FTS5 table.
    await db.exec("CREATE VIRTUAL TABLE __fts5_probe USING fts5(x); DROP TABLE __fts5_probe;");
    return true;
  } catch {
    return false;
  }
}

export async function runMigrations(db: DbDriver): Promise<void> {
  await ensureRegistry(db);
  const applied = await db.all<{ version: number }>(
    "SELECT version FROM schema_migrations ORDER BY version",
  );
  const appliedSet = new Set(applied.map((a) => a.version));
  const fts5 = await hasFts5(db);

  for (const m of MIGRATIONS) {
    if (appliedSet.has(m.version)) continue;
    if (m.requiresFts && !fts5) {
      // Skip FTS-dependent migration on platforms without the extension.
      // The version is intentionally NOT marked applied so a future SQLite
      // build that gains FTS5 will run it.
      continue;
    }
    await db.transaction(async (tx) => {
      await tx.exec(m.sql);
      await tx.run("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", [
        m.version,
        new Date().toISOString(),
      ]);
    });
  }
}

export async function isFtsAvailable(db: DbDriver): Promise<boolean> {
  const row = await db.get<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name = 'articles_fts'",
  );
  return row !== null;
}
