import type { DbDriver } from "../driver";
import sql001 from "./001_initial.sql";
import sql002 from "./002_fts.sql";

type Migration = { version: number; sql: string; name: string };

const MIGRATIONS: readonly Migration[] = [
  { version: 1, sql: sql001 as unknown as string, name: "001_initial" },
  { version: 2, sql: sql002 as unknown as string, name: "002_fts" },
];

async function ensureRegistry(db: DbDriver): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);
}

export async function runMigrations(db: DbDriver): Promise<void> {
  await ensureRegistry(db);
  const applied = await db.all<{ version: number }>(
    "SELECT version FROM schema_migrations ORDER BY version",
  );
  const appliedSet = new Set(applied.map((a) => a.version));

  for (const m of MIGRATIONS) {
    if (appliedSet.has(m.version)) continue;
    await db.transaction(async (tx) => {
      await tx.exec(m.sql);
      await tx.run("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", [
        m.version,
        new Date().toISOString(),
      ]);
    });
  }
}
