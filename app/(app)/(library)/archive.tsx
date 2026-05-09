import { useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { LibraryHeader } from "@/components/LibraryHeader";
import { ArticleList } from "@/components/ArticleList";
import { useArticles } from "@/hooks/useArticles";
import { useSyncNow } from "@/hooks/useSyncNow";
import { parseTagsParam } from "@/lib/tagParams";

export default function ArchiveRoute() {
  const params = useLocalSearchParams<{ tags?: string | string[] }>();
  const tagSlugs = parseTagsParam(params.tags);
  const articles = useArticles("archive", tagSlugs);
  const sync = useSyncNow();
  const [pulling, setPulling] = useState(false);
  const onRefresh = async () => {
    setPulling(true);
    try {
      await sync.mutateAsync();
    } finally {
      setPulling(false);
    }
  };
  return (
    <View className="flex-1">
      <LibraryHeader
        title="Archive"
        activeFilter="archive"
        activeTags={tagSlugs}
        {...(articles.data ? { count: articles.data.length } : {})}
      />
      <ArticleList
        articles={articles.data ?? []}
        loading={articles.isLoading}
        refreshing={pulling}
        onRefresh={onRefresh}
        suppressIndicatorFor="read"
        emptyTitle={tagSlugs.length > 0 ? "Nothing matches" : "Empty archive"}
        emptyDescription={
          tagSlugs.length > 0
            ? "No archived articles carry every selected tag."
            : "Archived articles live here so you remember they're done."
        }
      />
    </View>
  );
}
