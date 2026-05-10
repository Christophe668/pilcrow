import type { DbDriver } from "../driver";

export type AnnotationRow = {
  id: number;
  backend_id: string | null;
  article_id: number;
  quote: string;
  ranges_json: string;
  text: string | null;
  created_at: string | null;
  updated_at: string | null;
  pending_op: string | null;
};

const COLS = [
  "id",
  "backend_id",
  "article_id",
  "quote",
  "ranges_json",
  "text",
  "created_at",
  "updated_at",
  "pending_op",
] as const;

let nextTempId = -1;

export async function upsertAnnotations(
  db: DbDriver,
  rows: readonly Partial<AnnotationRow>[],
): Promise<void> {
  if (rows.length === 0) return;
  await db.transaction(async (tx) => {
    for (const a of rows) {
      const cols = COLS.filter((c) => a[c] !== undefined);
      const placeholders = cols.map(() => "?").join(", ");
      const updateSet = cols
        .filter((c) => c !== "id")
        .map((c) => `${c} = excluded.${c}`)
        .join(", ");
      const sql = `INSERT INTO annotations (${cols.join(", ")}) VALUES (${placeholders})
                   ON CONFLICT(id) DO UPDATE SET ${updateSet}`;
      await tx.run(
        sql,
        cols.map((c) => a[c] as unknown),
      );
    }
  });
}

export async function listAnnotations(db: DbDriver, articleId: number): Promise<AnnotationRow[]> {
  return db.all<AnnotationRow>(
    `SELECT ${COLS.join(", ")} FROM annotations
     WHERE article_id = ?
     ORDER BY id`,
    [articleId],
  );
}

export async function createAnnotation(
  db: DbDriver,
  payload: { article_id: number; quote: string; ranges_json: string; text: string | null },
): Promise<number> {
  const id = nextTempId--;
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO annotations (id, article_id, quote, ranges_json, text, created_at, updated_at, pending_op)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'create')`,
    [id, payload.article_id, payload.quote, payload.ranges_json, payload.text, now, now],
  );
  return id;
}

export async function deleteAnnotation(db: DbDriver, id: number): Promise<void> {
  await db.run(`UPDATE annotations SET pending_op = 'delete' WHERE id = ?`, [id]);
}

export async function rewriteAnnotationId(
  db: DbDriver,
  tempId: number,
  realId: number,
  backendId?: string,
): Promise<void> {
  await db.run(`UPDATE annotations SET id = ?, backend_id = ?, pending_op = NULL WHERE id = ?`, [
    realId,
    backendId ?? String(realId),
    tempId,
  ]);
}

export async function findAnnotationByBackendId(
  db: DbDriver,
  backendId: string,
): Promise<AnnotationRow | null> {
  return db.get<AnnotationRow>(`SELECT ${COLS.join(", ")} FROM annotations WHERE backend_id = ?`, [
    backendId,
  ]);
}

export async function purgeDeleted(db: DbDriver, id: number): Promise<void> {
  await db.run(`DELETE FROM annotations WHERE id = ? AND pending_op = 'delete'`, [id]);
}
