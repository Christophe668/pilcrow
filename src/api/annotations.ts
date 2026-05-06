import { authedRequest } from "./client";
import type { Annotation } from "./types";

export async function listAnnotations(entryId: number): Promise<Annotation[]> {
  const r = await authedRequest<{ total: number; rows: Annotation[] }>({
    method: "GET",
    path: `/api/annotations/${entryId}.json`,
  });
  return r.rows;
}

export async function createAnnotation(
  entryId: number,
  payload: { quote: string; ranges: Annotation["ranges"]; text: string | null },
): Promise<Annotation> {
  return authedRequest<Annotation>({
    method: "POST",
    path: `/api/annotations/${entryId}.json`,
    body: payload,
  });
}

export async function updateAnnotation(
  id: number,
  patch: { text?: string | null },
): Promise<Annotation> {
  return authedRequest<Annotation>({
    method: "PUT",
    path: `/api/annotations/${id}.json`,
    body: patch,
  });
}

export async function deleteAnnotation(id: number): Promise<void> {
  await authedRequest<unknown>({ method: "DELETE", path: `/api/annotations/${id}.json` });
}
