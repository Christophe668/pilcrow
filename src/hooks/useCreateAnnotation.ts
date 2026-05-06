import { useMutation } from "@tanstack/react-query";
import { getDb } from "@/db";
import { createAnnotation as repoCreate } from "@/db/repos/annotations";
import { enqueue } from "@/db/repos/outbox";
import { dataEvents } from "@/sync/events";
import type { Annotation } from "@/api/types";

export type AnnotationRange = Annotation["ranges"][number];

export async function createAnnotationAction(args: {
  articleId: number;
  quote: string;
  ranges: AnnotationRange[];
  text: string | null;
}): Promise<number> {
  const db = await getDb();
  const tempId = await repoCreate(db, {
    article_id: args.articleId,
    quote: args.quote,
    ranges_json: JSON.stringify(args.ranges),
    text: args.text,
  });
  await enqueue(db, "createAnnotation", {
    tempId,
    entryId: args.articleId,
    quote: args.quote,
    ranges: args.ranges,
    text: args.text,
  });
  dataEvents.emit({ kind: "annotations", articleId: args.articleId });
  return tempId;
}

export function useCreateAnnotation() {
  return useMutation({
    mutationFn: (args: {
      articleId: number;
      quote: string;
      ranges: AnnotationRange[];
      text: string | null;
    }) => createAnnotationAction(args),
  });
}
