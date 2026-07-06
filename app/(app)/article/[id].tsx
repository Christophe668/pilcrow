import { useEffect, useMemo, useRef, useState } from "react";
import { Linking, Platform, View } from "react-native";
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
import { OverflowSheet, type OverflowItem } from "@/components/OverflowSheet";
import { SelectionToolbar } from "@/components/SelectionToolbar";
import { AnnotationSheet } from "@/components/AnnotationSheet";
import { LiveWebView } from "@/components/LiveWebView";
import { ArticleHeader, type ArticleMode } from "@/components/ArticleHeader";
import { ReaderSkeleton } from "@/components/ReaderSkeleton";
import { ExtractionFailedView } from "@/components/ExtractionFailedView";
import { ensureCached, buildLocalLookup } from "@/images/cache";
import { getDb } from "@/db";
import { setScrollPosition } from "@/db/repos/articles";
import { createAnnotationAction } from "@/hooks/useCreateAnnotation";
import { useReloadEntry } from "@/hooks/useReloadEntry";
import { showSnackbar } from "@/components/snackbar-store";
import { goBackOrHome } from "@/lib/navigation";
import { isExtractionFailed } from "@/reader/extraction-failed";

type SelectionState = { active: false } | { active: true; text: string; ranges: SerializedRange };

export default function ArticleRoute() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const articleId = Number(id);
  const article = useFullArticle(articleId);
  const annotations = useAnnotations(articleId);
  const reload = useReloadEntry();
  const { prefs } = useReaderPrefs();

  const [showPrefs, setShowPrefs] = useState(false);
  const [viewingLive, setViewingLive] = useState(false);
  const [overrideExtractionCheck, setOverrideExtractionCheck] = useState(false);
  const [overflowItems, setOverflowItems] = useState<OverflowItem[] | null>(null);
  const [imageLookup, setImageLookup] = useState<((src: string) => string | null) | null>(null);
  const [selection, setSelection] = useState<SelectionState>({ active: false });
  const [openAnnotation, setOpenAnnotation] = useState<{
    id: number;
    quote: string;
    text: string | null;
  } | null>(null);

  const readerRef = useRef<ReaderContentHandle | null>(null);
  const renderedAnnotationIds = useRef<Set<number>>(new Set());
  // Bridge readiness gates annotation rendering: posting render-annotations
  // before the injected script registers its message listener drops them.
  const [readerReady, setReaderReady] = useState(false);

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

  // Push annotations into the reader on every change (and on bridge ready).
  useEffect(() => {
    if (!readerReady || !annotations.data || !readerRef.current) return;
    // Reconcile before rendering: the outbox drain rewrites temp ids to
    // server ids (and deletes drop rows), so a rendered id that no longer
    // exists must be unwrapped — otherwise the re-render under the new id
    // nests a second mark over the same text and the old mark's click id
    // points at a dead annotation.
    const liveIds = new Set(annotations.data.map((a) => a.id));
    for (const staleId of renderedAnnotationIds.current) {
      if (!liveIds.has(staleId)) {
        readerRef.current.post({ kind: "unwrap-annotation", id: staleId });
        renderedAnnotationIds.current.delete(staleId);
      }
    }
    const items: { id: number; ranges: SerializedRange }[] = [];
    for (const a of annotations.data) {
      if (renderedAnnotationIds.current.has(a.id)) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(a.ranges_json);
      } catch {
        continue; // corrupt row — skip it rather than lose every highlight
      }
      const ranges = Array.isArray(parsed) ? (parsed[0] as SerializedRange | undefined) : undefined;
      if (ranges) items.push({ id: a.id, ranges });
    }
    if (items.length === 0) return;
    readerRef.current.post({ kind: "render-annotations", items });
    items.forEach((it) => renderedAnnotationIds.current.add(it.id));
  }, [annotations.data, readerReady]);

  // Reset rendered-set (and readiness — the document reloads, so the bridge
  // must announce itself again) when the article changes.
  useEffect(() => {
    renderedAnnotationIds.current.clear();
    setReaderReady(false);
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

  const onAnnotate = async () => {
    if (!selection.active) return;
    const text = selection.text;
    const ranges = selection.ranges;
    const tempId = await createAnnotationAction({
      articleId,
      quote: text,
      ranges: [ranges],
      text: null,
    });
    readerRef.current?.post({ kind: "wrap-selection", tempId, ranges });
    renderedAnnotationIds.current.add(tempId);
    setSelection({ active: false });
    // Open the annotation editor in the same gesture so the user can write
    // a note while the quote is still in their head.
    setOpenAnnotation({ id: tempId, quote: text, text: null });
  };

  // Loading state — typographic skeleton, header in its loaded-but-empty
  // shape so the chrome doesn't pop in afterwards.
  if (article.isLoading || !article.data) {
    return (
      <View className="flex-1 bg-bg">
        <ArticleHeader
          title={null}
          domain={null}
          readingTimeMin={null}
          savedAt={null}
          mode={null}
          onChangeMode={() => undefined}
          onBack={() => goBackOrHome(router)}
          onOpenOriginal={() => undefined}
          onOpenPrefs={() => undefined}
        />
        <ReaderSkeleton />
      </View>
    );
  }

  const articleUrl = article.data.url;
  const onOpenOriginal = async () => {
    await Linking.openURL(articleUrl).catch(() => undefined);
  };

  // Show the segmented control whenever the user has a meaningful choice —
  // either extraction failed (so Reader is just a failure card) or they're
  // actively in live view. On web there's no useful "Live" mode (iframing
  // most sites is blocked by X-Frame-Options), so the segmented stays
  // hidden and the user gets "Open original" only.
  const extractionFailed = !overrideExtractionCheck && isExtractionFailed(article.data.content);
  const mode: ArticleMode | null =
    Platform.OS === "web"
      ? null
      : viewingLive || extractionFailed
        ? viewingLive
          ? "live"
          : "reader"
        : null;

  return (
    <View className="flex-1 bg-bg">
      <ArticleHeader
        title={article.data.title}
        domain={article.data.domain_name}
        readingTimeMin={article.data.reading_time}
        savedAt={article.data.created_at}
        mode={mode}
        onChangeMode={(m) => setViewingLive(m === "live")}
        onBack={() => goBackOrHome(router)}
        onOpenOriginal={onOpenOriginal}
        onOpenPrefs={() => setShowPrefs(true)}
      />
      <View className="flex-1">
        {viewingLive && Platform.OS !== "web" ? (
          <LiveWebView url={articleUrl} />
        ) : extractionFailed ? (
          <ExtractionFailedView
            url={articleUrl}
            onOpenOriginal={onOpenOriginal}
            onViewLive={Platform.OS === "web" ? null : () => setViewingLive(true)}
            onReload={async () => {
              try {
                await reload.mutateAsync(articleId);
                showSnackbar({ message: "Reloaded" });
              } catch (e) {
                // Session expiry is handled by the api client (signOut +
                // auth-gate redirect); don't double-toast on top of it.
                if (e instanceof Error && e.name === "SessionExpiredError") return;
                showSnackbar({
                  message: e instanceof Error ? `Reload failed: ${e.message}` : "Reload failed",
                });
              }
            }}
            reloading={reload.isPending}
            onShowAnyway={() => setOverrideExtractionCheck(true)}
          />
        ) : built ? (
          <ReaderContent
            ref={readerRef}
            document={built.document}
            initialScroll={initialScroll}
            onReady={() => setReaderReady(true)}
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
          <ReaderSkeleton />
        )}
      </View>
      <SelectionToolbar
        visible={selection.active && !openAnnotation && !showPrefs && !viewingLive}
        onHighlight={onHighlight}
        onAnnotate={onAnnotate}
        onDismiss={() => setSelection({ active: false })}
      />
      <ActionBar
        articleId={articleId}
        url={article.data.url}
        title={article.data.title}
        isStarred={article.data.is_starred === 1}
        isArchived={article.data.is_archived === 1}
        onShowOverflow={(items) => setOverflowItems(items)}
      />
      {/* Overflow sheet rendered at the route's root, not inside ActionBar
          — react-native-screens transforms break Modal positioning on web,
          so the sheet has to live where it can absolute-cover the entire
          flex-1 route. */}
      <OverflowSheet
        visible={overflowItems !== null}
        items={overflowItems ?? []}
        onClose={() => setOverflowItems(null)}
      />
      {showPrefs ? <ReaderPrefsSheet onClose={() => setShowPrefs(false)} /> : null}
      <AnnotationSheet
        annotation={openAnnotation}
        onClose={() => setOpenAnnotation(null)}
        onDeleted={(annoId) => {
          // Remove the mark immediately; the annotations query refetch also
          // reconciles, but that round-trip would leave a stale highlight up.
          readerRef.current?.post({ kind: "unwrap-annotation", id: annoId });
          renderedAnnotationIds.current.delete(annoId);
        }}
      />
    </View>
  );
}
