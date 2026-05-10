import { rawRequest, request } from "./client";
import type { ReadeckAnnotation, ReadeckAnnotationCreate, ReadeckAnnotationPatch } from "./types";

type Auth = { serverUrl: string; accessToken: string };

export async function listAnnotations(
  auth: Auth,
  bookmarkId: string,
): Promise<ReadeckAnnotation[]> {
  return request<ReadeckAnnotation[]>({
    ...auth,
    method: "GET",
    path: `/api/bookmarks/${encodeURIComponent(bookmarkId)}/annotations`,
  });
}

export async function createAnnotation(
  auth: Auth,
  bookmarkId: string,
  payload: ReadeckAnnotationCreate,
): Promise<ReadeckAnnotation> {
  return request<ReadeckAnnotation>({
    ...auth,
    method: "POST",
    path: `/api/bookmarks/${encodeURIComponent(bookmarkId)}/annotations`,
    body: payload,
  });
}

export async function updateAnnotation(
  auth: Auth,
  bookmarkId: string,
  annotationId: string,
  patch: ReadeckAnnotationPatch,
): Promise<ReadeckAnnotation> {
  return request<ReadeckAnnotation>({
    ...auth,
    method: "PATCH",
    path: `/api/bookmarks/${encodeURIComponent(bookmarkId)}/annotations/${encodeURIComponent(annotationId)}`,
    body: patch,
  });
}

export async function deleteAnnotation(
  auth: Auth,
  bookmarkId: string,
  annotationId: string,
): Promise<void> {
  await rawRequest({
    ...auth,
    method: "DELETE",
    path: `/api/bookmarks/${encodeURIComponent(bookmarkId)}/annotations/${encodeURIComponent(annotationId)}`,
  });
}
