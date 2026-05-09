import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Link, useLocalSearchParams, usePathname, useRouter, useSegments } from "expo-router";
import type { Href } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useTagsWithCounts } from "@/hooks/useTagsWithCounts";
import { useFilterCounts } from "@/hooks/useFilterCounts";
import type { Filter } from "@/db/repos/articles";
import { useTokens } from "@/theme/provider";
import { parseTagsParam, serializeTagsParam, toggleTag } from "@/lib/tagParams";

type FilterRow = {
  route: Href;
  label: string;
  segment: string;
  /** Only set on filters where the count is actionable — Unread, In
   * progress, Starred. */
  countKey?: Filter;
};

const FILTERS: readonly FilterRow[] = [
  { route: "/(app)/(library)" as Href, label: "Unread", segment: "index", countKey: "unread" },
  {
    route: "/(app)/(library)/in-progress" as Href,
    label: "In progress",
    segment: "in-progress",
    countKey: "in-progress",
  },
  {
    route: "/(app)/(library)/starred" as Href,
    label: "Starred",
    segment: "starred",
    countKey: "starred",
  },
  { route: "/(app)/(library)/archive" as Href, label: "Archive", segment: "archive" },
  { route: "/(app)/(library)/all" as Href, label: "All", segment: "all" },
  { route: "/(app)/(library)/stats" as Href, label: "Stats", segment: "stats" },
];

const VISIBLE_TAGS = 30;

/**
 * Sidebar shown on tablet/desktop. Top: search box (so search has an
 * entry point on wide screens, where the bottom TabBar is hidden).
 * Middle: bucket filters with badge counts where actionable. Bottom:
 * tag list — multi-select; clicking a tag toggles its inclusion in the
 * current route's `?tags=` query, layering on top of whatever bucket
 * the user is currently in.
 */
export function Rail() {
  const segments = useSegments() as string[];
  const tags = useTagsWithCounts();
  const counts = useFilterCounts();
  const router = useRouter();
  const pathname = usePathname();
  const params = useLocalSearchParams<{ tags?: string | string[] }>();
  const tokens = useTokens();
  const [query, setQuery] = useState("");

  const activeTags = parseTagsParam(params.tags);

  const submitSearch = () => {
    const q = query.trim();
    if (q.length === 0) {
      router.push("/(app)/(library)/search" as Href);
    } else {
      router.push(`/(app)/(library)/search?q=${encodeURIComponent(q)}` as Href);
    }
  };

  const isLibraryRoute = pathname.startsWith("/") && !pathname.includes("/search");

  const handleTagPress = (slug: string) => {
    const next = toggleTag(activeTags, slug);
    if (isLibraryRoute) {
      // Stay in the current bucket and just update the tags param.
      router.setParams({ tags: serializeTagsParam(next) });
    } else {
      // Coming from a non-library route (e.g. settings) — land on All.
      const tagsParam = serializeTagsParam(next);
      router.push(
        (tagsParam ? `/(app)/(library)/all?tags=${tagsParam}` : "/(app)/(library)/all") as Href,
      );
    }
  };

  const visibleTags = (tags.data ?? []).slice(0, VISIBLE_TAGS);
  const overflowCount = (tags.data?.length ?? 0) - visibleTags.length;

  return (
    <ScrollView className="bg-bg" contentContainerClassName="px-5 pt-8 pb-12">
      <View className="flex-row items-center bg-surface border border-border rounded-md px-3 py-2 mb-7">
        <Feather name="search" size={14} color={tokens.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={submitSearch}
          placeholder="Search"
          placeholderTextColor={tokens.subtle}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          className="flex-1 ml-2 text-fg text-sm"
          style={{ outlineWidth: 0 } as object}
        />
      </View>

      <SectionHeader label="Library" />
      <View className="mb-8">
        {FILTERS.map((f) => {
          const isActive =
            (f.segment === "index" && segments[segments.length - 1] === "(library)") ||
            segments.includes(f.segment);
          const n = f.countKey ? counts.data?.[f.countKey] : undefined;
          return (
            <Link key={f.label} href={f.route} asChild>
              <Pressable className={`${rowClass(isActive)} hover:bg-surface-2 active:bg-surface-2`}>
                <View className="flex-row items-center justify-between">
                  <Text className={labelClass(isActive)}>{f.label}</Text>
                  {typeof n === "number" ? <Text className={countClass(isActive)}>{n}</Text> : null}
                </View>
              </Pressable>
            </Link>
          );
        })}
      </View>

      <SectionHeader label="Tags" />
      <View>
        {visibleTags.map((t) => {
          const isActive = activeTags.includes(t.slug);
          return (
            <Pressable
              key={t.id}
              accessibilityRole="button"
              accessibilityLabel={`${isActive ? "remove" : "add"} tag ${t.label}`}
              accessibilityState={{ selected: isActive }}
              onPress={() => handleTagPress(t.slug)}
              className={`${rowClass(isActive)} hover:bg-surface-2 active:bg-surface-2`}
            >
              <Text
                className={isActive ? "text-accent-ink text-sm" : "text-fg text-sm"}
                numberOfLines={1}
              >
                <Text className="text-subtle">#</Text>
                {t.label}
              </Text>
            </Pressable>
          );
        })}
        {overflowCount > 0 ? (
          <View className="px-2 py-1.5">
            <Text className="text-subtle text-xs italic">+{overflowCount} more tags</Text>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <Text
      className="font-mono text-subtle uppercase mb-2 px-2"
      style={{ fontSize: 10, letterSpacing: 1.5 }}
    >
      {label}
    </Text>
  );
}

function rowClass(active: boolean): string {
  return active ? "px-2 py-1.5 rounded-md bg-accent-soft mb-0.5" : "px-2 py-1.5 rounded-md mb-0.5";
}

function labelClass(active: boolean): string {
  return active ? "text-accent-ink text-sm font-medium" : "text-fg text-sm";
}

function countClass(active: boolean): string {
  return active
    ? "text-accent-ink text-xs tabular-nums ml-2 opacity-70"
    : "text-subtle text-xs tabular-nums ml-2";
}
