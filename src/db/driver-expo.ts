import * as SQLite from "expo-sqlite";
import type { DbDriver, RunResult } from "./driver";

class ExpoSqliteDriver implements DbDriver {
  // Serializes transactions across the connection. expo-sqlite's
  // `withTransactionAsync` does NOT queue concurrent callers on the
  // web target — overlapping `db.transaction(...)` calls (sync engine
  // + a parallel TanStack Query refetch, say) collide on BEGIN with
  // "transaction within a transaction", or leak rollbacks across
  // each other. The mutex chains them through a single promise.
  private txnQueue: Promise<unknown> = Promise.resolve();

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
    // Chain onto the txn queue so only one transaction is in flight
    // on this connection at a time. The `.catch(() => {})` keeps the
    // queue alive even if a prior transaction rejected — the rejection
    // is propagated to the caller that owned it, not to the next one.
    const run = async (): Promise<T> => {
      let result: T;
      let captured: unknown;
      try {
        await this.db.withTransactionAsync(async () => {
          try {
            result = await fn(this);
          } catch (e) {
            captured = e;
            throw e;
          }
        });
      } catch (wrapperErr) {
        if (captured !== undefined && captured !== wrapperErr && __DEV__) {
          // eslint-disable-next-line no-console
          console.warn("[db] txn rolled back; original error:", captured);
        }
        throw captured ?? wrapperErr;
      }
      return result!;
    };
    const next = this.txnQueue.then(run, run);
    this.txnQueue = next.catch(() => undefined);
    return next;
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
