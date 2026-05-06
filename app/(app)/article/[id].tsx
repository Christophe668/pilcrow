import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useFullArticle } from "@/hooks/useFullArticle";
import { useReaderPrefs } from "@/hooks/useReaderPrefs";
import { ReaderContent } from "@/reader/ReaderContent";
import { buildReaderHtml } from "@/reader/pipeline";
import { ReaderPrefsSheet } from "@/components/ReaderPrefsSheet";
import { ActionBar } from "@/components/ActionBar";
import { ensureCached, buildLocalLookup } from "@/images/cache";
import { getDb } from "@/db";
import { setScrollPosition } from "@/db/repos/articles";

export default function ArticleRoute() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const articleId = Number(id);
  const article = useFullArticle(articleId);
  const { prefs } = useReaderPrefs();

  const [showPrefs, setShowPrefs] = useState(false);
  const [imageLookup, setImageLookup] = useState<((src: string) => string | null) | null>(null);

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

  const initialScroll = article.data?.scroll_position ?? 0;

  if (article.isLoading || !article.data) {
    return (
      <View className="flex-1 bg-bg items-center justify-center">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-bg">
      <View className="px-6 pt-12 pb-3 border-b border-border flex-row items-center justify-between">
        <Pressable accessibilityRole="button" onPress={() => router.back()}>
          <Text className="text-accent text-base">← Back</Text>
        </Pressable>
        <Text className="text-subtle text-xs flex-1 ml-3" numberOfLines={1}>
          {article.data.url}
        </Text>
      </View>
      <View className="flex-1">
        {built ? (
          <ReaderContent
            document={built.document}
            initialScroll={initialScroll}
            onScroll={(p) => {
              void getDb().then((db) => setScrollPosition(db, articleId, p));
            }}
          />
        ) : (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator />
          </View>
        )}
      </View>
      <ActionBar
        articleId={articleId}
        url={article.data.url}
        title={article.data.title}
        isStarred={article.data.is_starred === 1}
        isArchived={article.data.is_archived === 1}
        onOpenPrefs={() => setShowPrefs(true)}
      />
      {showPrefs ? <ReaderPrefsSheet onClose={() => setShowPrefs(false)} /> : null}
    </View>
  );
}
