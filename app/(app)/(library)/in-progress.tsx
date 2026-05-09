import { useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { LibraryHeader } from "@/components/LibraryHeader";
import { ArticleList } from "@/components/ArticleList";
import { useArticles } from "@/hooks/useArticles";
import { useSyncNow } from "@/hooks/useSyncNow";
import { parseTagsParam } from "@/lib/tagParams";

/**
 * Articles you've started but haven't finished. Computed from
 * `scroll_position` — anything between 5% and 95% reading depth that
 * hasn't been archived. Layers any selected tags on top of that base
 * filter.
 */
export default function InProgressRoute() {
  const params = useLocalSearchParams<{ tags?: string | string[] }>();
  const tagSlugs = parseTagsParam(params.tags);
  const articles = useArticles("in-progress", tagSlugs);
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
        title="In progress"
        activeFilter="in-progress"
        activeTags={tagSlugs}
        {...(articles.data ? { count: articles.data.length } : {})}
      />
      <ArticleList
        articles={articles.data ?? []}
        loading={articles.isLoading}
        refreshing={pulling}
        onRefresh={onRefresh}
        suppressIndicatorFor="in-progress"
        emptyTitle={tagSlugs.length > 0 ? "Nothing matches" : "Nothing in progress"}
        emptyDescription={
          tagSlugs.length > 0
            ? "No in-progress articles carry every selected tag."
            : "Articles you've started reading but not finished show up here."
        }
      />
    </View>
  );
}
