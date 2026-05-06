import Database from "better-sqlite3";
import type { DbDriver, RunResult } from "./driver";

class BetterSqliteDriver implements DbDriver {
  constructor(private readonly db: Database.Database) {}

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async run(sql: string, params: readonly unknown[] = []): Promise<RunResult> {
    const stmt = this.db.prepare(sql);
    const r = stmt.run(...(params as unknown[]));
    return { changes: r.changes, lastId: r.lastInsertRowid };
  }

  async get<T>(sql: string, params: readonly unknown[] = []): Promise<T | null> {
    const stmt = this.db.prepare(sql);
    return (stmt.get(...(params as unknown[])) as T | undefined) ?? null;
  }

  async all<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    return stmt.all(...(params as unknown[])) as T[];
  }

  async transaction<T>(fn: (tx: DbDriver) => Promise<T>): Promise<T> {
    this.db.exec("BEGIN");
    try {
      const result = await fn(this);
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

export async function createBetterSqliteDriver(filename: string): Promise<DbDriver> {
  const db = new Database(filename);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return new BetterSqliteDriver(db);
}
