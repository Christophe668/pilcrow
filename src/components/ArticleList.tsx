import { useMemo } from "react";
import { FlashList } from "@shopify/flash-list";
import { Platform, RefreshControl, ScrollView, View } from "react-native";
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

const isWeb = Platform.OS === "web";

// Approx height of the SectionDivider when rendered — used to offset the
// pull-to-refresh spinner so it lands below the sticky header instead of
// behind it. Slight over-estimate is fine; under-estimate clips the
// spinner.
const STICKY_HEADER_HEIGHT = 56;

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

  // Indices of every header row, so the scroll container can pin them as
  // the user scrolls past. Headers are opaque (`bg-bg`) so the article
  // cards don't bleed through when the row is pinned.
  const stickyHeaderIndices = useMemo(
    () =>
      rows.reduce<number[]>((acc, row, i) => {
        if (row.kind === "header" || row.kind === "first-header") acc.push(i);
        return acc;
      }, []),
    [rows],
  );

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

  const renderRow = (row: Row) => {
    if (row.kind === "header") return <SectionDivider label={row.label} />;
    if (row.kind === "first-header") return <SectionDivider label={row.label} first />;
    const a = row.item;
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
  };

  // On web: the scroll context is the outermost wrapper so the entire
  // pane catches wheel events — putting the cursor anywhere in the side
  // gutters (outside the 760px column) still scrolls the list. Items
  // render inline; for the hundred-or-few-hundred-row lists we care
  // about, the virtualization win from FlashList isn't worth the
  // captured-scroll-zone trade-off.
  //
  // On native: FlashList stays. Touch always lands on content, so there
  // are no gutters to worry about; and virtualization actually matters
  // on a phone with a 500-row library.
  if (isWeb) {
    return (
      // The outer ScrollView fills the pane edge-to-edge so wheel
      // events anywhere in the right pane (including the empty gutters
      // either side of the 760px column) scroll the list. Centering
      // happens on the contentContainer so it doesn't squash the
      // scrollable region.
      <ScrollView
        className="flex-1"
        // Force the contentContainer to span the scrollview's full
        // width. Without `w-full` the container shrinks to its widest
        // child (the 760px article column), and headers — which have
        // no intrinsic width — collapse to whatever their content
        // happens to be wide.
        contentContainerClassName="w-full"
        stickyHeaderIndices={stickyHeaderIndices}
        refreshControl={
          // `progressViewOffset` pushes the Android spinner down past
          // the sticky section header so it doesn't drop in behind
          // the "TODAY"/"EARLIER THIS WEEK" label. No-op on iOS/web.
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            progressViewOffset={STICKY_HEADER_HEIGHT}
          />
        }
      >
        {rows.map((row) => {
          const isHeader = row.kind === "header" || row.kind === "first-header";
          // Header rows stretch edge-to-edge across the pane.
          // contentContainer defaults to align-items: stretch, so
          // children fill the cross axis without needing self-stretch.
          // Article rows cap at 760px and center via auto margins so
          // the header's full-width rule + label run across the whole
          // pane while content stays in its editorial column.
          if (isHeader) {
            return (
              <View key={row.key} className="bg-bg">
                {renderRow(row)}
              </View>
            );
          }
          return (
            <View key={row.key} className="w-full max-w-[760px] mx-auto">
              {renderRow(row)}
            </View>
          );
        })}
      </ScrollView>
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
          stickyHeaderIndices={stickyHeaderIndices}
          // Tell FlashList headers and items are different cell types so
          // it recycles within each kind, not across.
          getItemType={(r) => r.kind}
          renderItem={({ item }) => renderRow(item)}
          refreshControl={
            // `progressViewOffset` pushes the Android spinner down past
            // the sticky section header so it doesn't drop in behind
            // the "TODAY"/"EARLIER THIS WEEK" label. No-op on iOS/web.
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              progressViewOffset={STICKY_HEADER_HEIGHT}
            />
          }
        />
      </View>
    </View>
  );
}
