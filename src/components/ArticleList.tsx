import { useMemo } from "react";
import { FlashList } from "@shopify/flash-list";
import { RefreshControl, View } from "react-native";
import { ArticleCard, type ReadState } from "./ArticleCard";
import { EmptyState, type EmptyStateProps } from "./EmptyState";
import { ListSkeleton } from "./ListSkeleton";
import { SectionDivider } from "./SectionDivider";
import { groupByRecency, type Grouped } from "@/lib/groupByRecency";
import type { ArticleListItem } from "@/hooks/useArticles";

export type ArticleListProps = {
  articles: readonly ArticleListItem[];
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  emptyTitle: string;
  emptyDescription?: string;
  emptyAction?: EmptyStateProps["action"];
  /** Disable time-bucket section dividers — useful for derived views like
   * Search where the order isn't temporal. Defaults to enabled. */
  group?: boolean;
  /** When the host route filters to a single read state, pass it here so
   * cards can suppress the redundant state indicator (e.g. on the Unread
   * route, every card is unread; the dot adds no information). */
  suppressIndicatorFor?: ReadState;
};

type Row = Grouped<ArticleListItem> | { kind: "first-header"; key: string; label: string };

export function ArticleList({
  articles,
  loading,
  refreshing,
  onRefresh,
  emptyTitle,
  emptyDescription,
  emptyAction,
  group = true,
  suppressIndicatorFor,
}: ArticleListProps) {
  // Pre-compute the grouped row list. The list pane is sorted server-side
  // by updated_at DESC, so the bucket boundaries fall in order — no extra
  // sort needed.
  const rows = useMemo<Row[]>(() => {
    if (!group) {
      return articles.map((a) => ({ kind: "item", key: String(a.id), item: a }));
    }
    const grouped = groupByRecency(articles, {
      getTimestamp: (a) => a.updated_at,
      getKey: (a) => String(a.id),
    });
    // Mark the very first header so it can sit closer to the screen top —
    // the regular header padding assumes there's a card above it.
    if (grouped.length > 0 && grouped[0]!.kind === "header") {
      const first = grouped[0]!;
      return [{ kind: "first-header", key: first.key, label: first.label }, ...grouped.slice(1)];
    }
    return grouped;
  }, [articles, group]);

  if (loading && articles.length === 0) {
    // Width-cap the skeleton the same way the real list is capped so the
    // loading state lands in the final layout, not in a wider one.
    return (
      <View className="flex-1 items-center">
        <View className="w-full max-w-[760px]">
          <ListSkeleton />
        </View>
      </View>
    );
  }
  if (articles.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        {...(emptyDescription !== undefined ? { description: emptyDescription } : {})}
        {...(emptyAction !== undefined ? { action: emptyAction } : {})}
      />
    );
  }
  // The list pane is flex-1 with no max-width on the layout, so we cap it
  // here. On 4K monitors a 2400px-wide row reads as inhuman; 760px keeps
  // the column near the editorial sweet spot without wasting space.
  return (
    <View className="flex-1 items-center">
      <View className="flex-1 w-full max-w-[760px]">
        <FlashList
          data={rows}
          keyExtractor={(r) => r.key}
          // Tell FlashList headers and items are different cell types so
          // it recycles within each kind, not across.
          getItemType={(r) => r.kind}
          renderItem={({ item }) => {
            if (item.kind === "header") {
              return <SectionDivider label={item.label} />;
            }
            if (item.kind === "first-header") {
              return <SectionDivider label={item.label} first />;
            }
            const a = item.item;
            return (
              <ArticleCard
                id={a.id}
                title={a.title}
                url={a.url}
                domain={a.domain_name}
                readingTime={a.reading_time}
                isStarred={a.is_starred === 1}
                isArchived={a.is_archived === 1}
                scrollPosition={a.scroll_position}
                updatedAt={a.updated_at}
                previewImage={a.preview_picture}
                tags={a.tags}
                excerpt={a.excerpt}
                {...(suppressIndicatorFor !== undefined ? { suppressIndicatorFor } : {})}
              />
            );
          }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        />
      </View>
    </View>
  );
}
