import { useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { LibraryHeader } from "@/components/LibraryHeader";
import { ArticleList } from "@/components/ArticleList";
import { useArticles } from "@/hooks/useArticles";
import { useSyncNow } from "@/hooks/useSyncNow";
import { parseTagsParam } from "@/lib/tagParams";

export default function UnreadRoute() {
  const params = useLocalSearchParams<{ tags?: string | string[] }>();
  const tagSlugs = parseTagsParam(params.tags);
  const articles = useArticles("unread", tagSlugs);
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
        activeTags={tagSlugs}
        {...(articles.data ? { count: articles.data.length } : {})}
      />
      <ArticleList
        articles={articles.data ?? []}
        loading={articles.isLoading}
        refreshing={pulling}
        onRefresh={onRefresh}
        suppressIndicatorFor="unread"
        emptyTitle={tagSlugs.length > 0 ? "Nothing matches" : "No unread articles"}
        emptyDescription={
          tagSlugs.length > 0
            ? "No unread articles carry every selected tag. Try fewer tags or a different bucket."
            : "Articles you save show up here. Pull down to sync, or save one now."
        }
        emptyAction={
          tagSlugs.length > 0 ? undefined : { label: "Save an article", href: "/(app)/add" }
        }
      />
    </View>
  );
}
