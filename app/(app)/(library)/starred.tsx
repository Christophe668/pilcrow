import { useState } from "react";
import { View } from "react-native";
import { LibraryHeader } from "@/components/LibraryHeader";
import { ArticleList } from "@/components/ArticleList";
import { useArticles } from "@/hooks/useArticles";
import { useSyncNow } from "@/hooks/useSyncNow";

export default function StarredRoute() {
  const articles = useArticles("starred");
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
      <LibraryHeader title="Starred" {...(articles.data ? { count: articles.data.length } : {})} />
      <ArticleList
        articles={articles.data ?? []}
        loading={articles.isLoading}
        refreshing={pulling}
        onRefresh={onRefresh}
        emptyTitle="Nothing starred"
        emptyDescription="Tap the star on any article to bookmark it."
      />
    </View>
  );
}
