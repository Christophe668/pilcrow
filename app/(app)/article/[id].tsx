import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useFullArticle } from "@/hooks/useFullArticle";
import { useReaderPrefs } from "@/hooks/useReaderPrefs";
import { useAnnotations } from "@/hooks/useAnnotations";
import {
  ReaderContent,
  type ReaderContentHandle,
  type SerializedRange,
} from "@/reader/ReaderContent";
import { buildReaderHtml } from "@/reader/pipeline";
import { ReaderPrefsSheet } from "@/components/ReaderPrefsSheet";
import { ActionBar } from "@/components/ActionBar";
import { SelectionToolbar } from "@/components/SelectionToolbar";
import { AnnotationSheet } from "@/components/AnnotationSheet";
import { ensureCached, buildLocalLookup } from "@/images/cache";
import { getDb } from "@/db";
import { setScrollPosition } from "@/db/repos/articles";
import { createAnnotationAction } from "@/hooks/useCreateAnnotation";

type SelectionState = { active: false } | { active: true; text: string; ranges: SerializedRange };

export default function ArticleRoute() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const articleId = Number(id);
  const article = useFullArticle(articleId);
  const annotations = useAnnotations(articleId);
  const { prefs } = useReaderPrefs();

  const [showPrefs, setShowPrefs] = useState(false);
  const [imageLookup, setImageLookup] = useState<((src: string) => string | null) | null>(null);
  const [selection, setSelection] = useState<SelectionState>({ active: false });
  const [openAnnotation, setOpenAnnotation] = useState<{
    id: number;
    quote: string;
    text: string | null;
  } | null>(null);

  const readerRef = useRef<ReaderContentHandle | null>(null);
  const renderedAnnotationIds = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (article.data?.content == null) return;
    let cancelled = false;
    (async () => {
      const lookup = await buildLocalLookup(articleId);
      if (!cancelled) setImageLookup(() => lookup);
    })();
    return () => {
      cancelled = true;
    };
  }, [articleId, article.data?.content]);

  const built = useMemo(() => {
    if (!article.data || article.data.content == null || !imageLookup) return null;
    return buildReaderHtml({
      articleId,
      title: article.data.title,
      url: article.data.url,
      contentHtml: article.data.content,
      prefs,
      imageLookup,
    });
  }, [article.data, articleId, prefs, imageLookup]);

  useEffect(() => {
    if (!built || built.pendingImages.length === 0) return;
    void ensureCached(articleId, built.pendingImages).then(async (newMap) => {
      if (newMap.size === 0) return;
      const lookup = await buildLocalLookup(articleId);
      setImageLookup(() => lookup);
    });
  }, [built, articleId]);

  // Push annotations into the reader on every change.
  useEffect(() => {
    if (!annotations.data || !readerRef.current) return;
    const items: { id: number; ranges: SerializedRange }[] = [];
    for (const a of annotations.data) {
      if (renderedAnnotationIds.current.has(a.id)) continue;
      const ranges = (JSON.parse(a.ranges_json) as SerializedRange[])[0];
      if (ranges) items.push({ id: a.id, ranges });
    }
    if (items.length === 0) return;
    readerRef.current.post({ kind: "render-annotations", items });
    items.forEach((it) => renderedAnnotationIds.current.add(it.id));
  }, [annotations.data]);

  // Reset rendered-set when article changes.
  useEffect(() => {
    renderedAnnotationIds.current.clear();
  }, [articleId, built?.document]);

  const initialScroll = article.data?.scroll_position ?? 0;

  const onHighlight = async () => {
    if (!selection.active) return;
    const tempId = await createAnnotationAction({
      articleId,
      quote: selection.text,
      ranges: [selection.ranges],
      text: null,
    });
    readerRef.current?.post({
      kind: "wrap-selection",
      tempId,
      ranges: selection.ranges,
    });
    renderedAnnotationIds.current.add(tempId);
    setSelection({ active: false });
  };

  if (article.isLoading || !article.data) {
    return (
      <View className="flex-1 bg-bg items-center justify-center">
        <ActivityIndicator />
      </View>
    );
  }

  const meta = [
    article.data.domain_name,
    article.data.reading_time ? `${article.data.reading_time} min` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const progressPct = Math.round((article.data.scroll_position ?? 0) * 100);

  return (
    <View className="flex-1 bg-bg">
      <View className="px-6 pt-12 pb-3 border-b border-border bg-bg flex-row items-center gap-3">
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          className="px-2 py-1.5 rounded-md"
        >
          <Text className="text-muted text-sm">← Back</Text>
        </Pressable>
        <View className="flex-1 items-center">
          {meta.length > 0 ? (
            <Text className="text-muted text-xs" numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
          <View className="h-[2px] w-[80px] bg-border rounded-full mt-1.5 overflow-hidden">
            <View className="h-full bg-accent" style={{ width: `${progressPct}%` }} />
          </View>
        </View>
        <View className="w-[60px]" />
      </View>
      <View className="flex-1">
        {built ? (
          <ReaderContent
            ref={readerRef}
            document={built.document}
            initialScroll={initialScroll}
            onScroll={(p) => {
              void getDb().then((db) => setScrollPosition(db, articleId, p));
            }}
            onSelection={(text, ranges) => setSelection({ active: true, text, ranges })}
            onSelectionCleared={() => setSelection({ active: false })}
            onAnnotationClick={(annoId) => {
              const found = annotations.data?.find((a) => a.id === annoId);
              if (found) {
                setOpenAnnotation({
                  id: found.id,
                  quote: found.quote,
                  text: found.text,
                });
              }
            }}
            onAnnotationCreated={() => {
              // Bridge wrapped the new mark; nothing more to do.
            }}
          />
        ) : (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator />
          </View>
        )}
      </View>
      <SelectionToolbar
        visible={selection.active && !openAnnotation && !showPrefs}
        onHighlight={onHighlight}
        onDismiss={() => setSelection({ active: false })}
      />
      <ActionBar
        articleId={articleId}
        url={article.data.url}
        title={article.data.title}
        isStarred={article.data.is_starred === 1}
        isArchived={article.data.is_archived === 1}
        onOpenPrefs={() => setShowPrefs(true)}
      />
      {showPrefs ? <ReaderPrefsSheet onClose={() => setShowPrefs(false)} /> : null}
      <AnnotationSheet annotation={openAnnotation} onClose={() => setOpenAnnotation(null)} />
    </View>
  );
}
