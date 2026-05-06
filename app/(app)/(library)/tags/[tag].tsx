import { useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { LibraryHeader } from "@/components/LibraryHeader";
import { ArticleList } from "@/components/ArticleList";
import { useArticlesByTag } from "@/hooks/useArticlesByTag";
import { useSyncNow } from "@/hooks/useSyncNow";

export default function TagRoute() {
  const { tag } = useLocalSearchParams<{ tag: string }>();
  const slug = (tag ?? "").toString();
  const articles = useArticlesByTag(slug);
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
        title={`#${slug}`}
        activeFilter="tag"
        {...(articles.data ? { count: articles.data.length } : {})}
      />
      <ArticleList
        articles={articles.data ?? []}
        loading={articles.isLoading}
        refreshing={pulling}
        onRefresh={onRefresh}
        emptyTitle={`Nothing tagged #${slug}`}
        emptyDescription="Tagged articles will appear here."
      />
    </View>
  );
}
