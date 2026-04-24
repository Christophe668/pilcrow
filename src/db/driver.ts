export type RunResult = { changes: number; lastId: number | bigint };

export interface DbDriver {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: readonly unknown[]): Promise<RunResult>;
  get<T>(sql: string, params?: readonly unknown[]): Promise<T | null>;
  all<T>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  transaction<T>(fn: (tx: DbDriver) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
