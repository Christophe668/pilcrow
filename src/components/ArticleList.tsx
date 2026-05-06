import { FlashList } from "@shopify/flash-list";
import { ActivityIndicator, RefreshControl, View } from "react-native";
import { ArticleCard } from "./ArticleCard";
import { EmptyState } from "./EmptyState";
import type { ArticleListItem } from "@/hooks/useArticles";

export type ArticleListProps = {
  articles: readonly ArticleListItem[];
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  emptyTitle: string;
  emptyDescription?: string;
};

export function ArticleList({
  articles,
  loading,
  refreshing,
  onRefresh,
  emptyTitle,
  emptyDescription,
}: ArticleListProps) {
  if (loading && articles.length === 0) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator />
      </View>
    );
  }
  if (articles.length === 0) {
    return emptyDescription !== undefined ? (
      <EmptyState title={emptyTitle} description={emptyDescription} />
    ) : (
      <EmptyState title={emptyTitle} />
    );
  }
  return (
    <FlashList
      data={articles}
      keyExtractor={(it) => String(it.id)}
      renderItem={({ item }) => (
        <ArticleCard
          id={item.id}
          title={item.title}
          url={item.url}
          domain={item.domain_name}
          readingTime={item.reading_time}
          isStarred={item.is_starred === 1}
          isArchived={item.is_archived === 1}
          updatedAt={item.updated_at}
          previewImage={item.preview_picture}
          tags={item.tags}
          excerpt={item.content}
        />
      )}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    />
  );
}
