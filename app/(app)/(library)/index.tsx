import { useState } from "react";
import { View } from "react-native";
import { LibraryHeader } from "@/components/LibraryHeader";
import { ArticleList } from "@/components/ArticleList";
import { useArticles } from "@/hooks/useArticles";
import { useSyncNow } from "@/hooks/useSyncNow";

export default function UnreadRoute() {
  const articles = useArticles("unread");
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
        title="Unread"
        activeFilter="unread"
        {...(articles.data ? { count: articles.data.length } : {})}
      />
      <ArticleList
        articles={articles.data ?? []}
        loading={articles.isLoading}
        refreshing={pulling}
        onRefresh={onRefresh}
        emptyTitle="No unread articles"
        emptyDescription="Articles you save show up here. Pull down to sync."
      />
    </View>
  );
}
