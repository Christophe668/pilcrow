import * as SQLite from "expo-sqlite";
import type { DbDriver, RunResult } from "./driver";

class ExpoSqliteDriver implements DbDriver {
  constructor(private readonly db: SQLite.SQLiteDatabase) {}

  async exec(sql: string): Promise<void> {
    await this.db.execAsync(sql);
  }

  async run(sql: string, params: readonly unknown[] = []): Promise<RunResult> {
    const r = await this.db.runAsync(sql, params as SQLite.SQLiteBindValue[]);
    return { changes: r.changes, lastId: r.lastInsertRowId };
  }

  async get<T>(sql: string, params: readonly unknown[] = []): Promise<T | null> {
    const row = await this.db.getFirstAsync<T>(sql, params as SQLite.SQLiteBindValue[]);
    return row ?? null;
  }

  async all<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    return this.db.getAllAsync<T>(sql, params as SQLite.SQLiteBindValue[]);
  }

  async transaction<T>(fn: (tx: DbDriver) => Promise<T>): Promise<T> {
    let result: T;
    await this.db.withTransactionAsync(async () => {
      result = await fn(this);
    });
    return result!;
  }

  async close(): Promise<void> {
    await this.db.closeAsync();
  }
}

export async function createExpoSqliteDriver(name: string): Promise<DbDriver> {
  const db = await SQLite.openDatabaseAsync(name, { useNewConnection: false });
  await db.execAsync("PRAGMA journal_mode = WAL");
  await db.execAsync("PRAGMA foreign_keys = ON");
  return new ExpoSqliteDriver(db);
}
