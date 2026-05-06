import type { DbDriver } from "../driver";

export type OutboxOp =
  | "createEntry"
  | "updateEntry"
  | "deleteEntry"
  | "addTag"
  | "removeTag"
  | "createAnnotation"
  | "updateAnnotation"
  | "deleteAnnotation";

export type OutboxRow = {
  id: number;
  op: OutboxOp;
  payload_json: string;
  created_at: string;
  attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
};

const MAX_BACKOFF_SECONDS = 600;

function backoffSeconds(attempts: number): number {
  return Math.min(MAX_BACKOFF_SECONDS, 2 ** Math.max(0, attempts - 1));
}

export async function enqueue(db: DbDriver, op: OutboxOp, payload: unknown): Promise<number> {
  const now = new Date().toISOString();
  const r = await db.run(
    `INSERT INTO outbox (op, payload_json, created_at, next_attempt_at) VALUES (?, ?, ?, ?)`,
    [op, JSON.stringify(payload), now, now],
  );
  return Number(r.lastId);
}

export async function peekDue(db: DbDriver, limit: number): Promise<OutboxRow[]> {
  const now = new Date().toISOString();
  return db.all<OutboxRow>(
    `SELECT id, op, payload_json, created_at, attempts, next_attempt_at, last_error
     FROM outbox
     WHERE next_attempt_at IS NULL OR next_attempt_at <= ?
     ORDER BY id
     LIMIT ?`,
    [now, limit],
  );
}

export async function markFailure(db: DbDriver, id: number, error: string): Promise<void> {
  const row = await db.get<{ attempts: number }>("SELECT attempts FROM outbox WHERE id = ?", [id]);
  const nextAttempts = (row?.attempts ?? 0) + 1;
  const next = new Date(Date.now() + backoffSeconds(nextAttempts) * 1000).toISOString();
  await db.run(`UPDATE outbox SET attempts = ?, next_attempt_at = ?, last_error = ? WHERE id = ?`, [
    nextAttempts,
    next,
    error,
    id,
  ]);
}

export async function markSuccess(db: DbDriver, id: number): Promise<void> {
  await db.run("DELETE FROM outbox WHERE id = ?", [id]);
}
