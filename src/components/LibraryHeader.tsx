import { Pressable, Text, View } from "react-native";
import { Link, useRouter, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useBreakpoint } from "@/hooks/useResponsive";
import { useTokens } from "@/theme/provider";
import { serializeTagsParam } from "@/lib/tagParams";

export type LibraryFilter =
  | "unread"
  | "in-progress"
  | "starred"
  | "archive"
  | "all"
  | "tag"
  | "search";

type PillDef = {
  key: LibraryFilter;
  label: string;
  href: Href;
};

const PILLS: readonly PillDef[] = [
  { key: "unread", label: "Unread", href: "/(app)/(library)" as Href },
  { key: "in-progress", label: "In progress", href: "/(app)/(library)/in-progress" as Href },
  { key: "starred", label: "Starred", href: "/(app)/(library)/starred" as Href },
  { key: "archive", label: "Archive", href: "/(app)/(library)/archive" as Href },
  { key: "all", label: "All", href: "/(app)/(library)/all" as Href },
];

export type LibraryHeaderProps = {
  title: string;
  count?: number;
  activeFilter?: LibraryFilter;
  /** Tag slugs currently overlaid on the bucket filter. Each renders as a
   * chip with × — tapping the × removes that tag from the URL via
   * setParams, keeping the user on the same bucket. */
  activeTags?: readonly string[];
};

export function LibraryHeader({ title, count, activeFilter, activeTags = [] }: LibraryHeaderProps) {
  const insets = useSafeAreaInsets();
  const breakpoint = useBreakpoint();
  const router = useRouter();
  const tokens = useTokens();
  const showPills = breakpoint === "phone" && !!activeFilter;

  const removeTag = (slug: string) => {
    const next = activeTags.filter((s) => s !== slug);
    router.setParams({ tags: serializeTagsParam(next) });
  };
  const clearAll = () => router.setParams({ tags: undefined });

  return (
    <View className="px-6 pb-4 border-b border-border" style={{ paddingTop: insets.top + 16 }}>
      <View className="flex-row items-baseline justify-between">
        <Text className="font-display text-fg text-3xl">{title}</Text>
        {typeof count === "number" ? (
          <Text className="text-subtle text-xs tabular-nums tracking-widest uppercase">
            {count} {count === 1 ? "item" : "items"}
          </Text>
        ) : null}
      </View>

      {activeTags.length > 0 ? (
        <View className="flex-row flex-wrap items-center gap-1.5 mt-3">
          {activeTags.map((slug) => (
            <Pressable
              key={slug}
              accessibilityRole="button"
              accessibilityLabel={`remove tag ${slug}`}
              onPress={() => removeTag(slug)}
              className="flex-row items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent-soft hover:bg-accent-soft active:opacity-80"
            >
              <Text className="text-accent-ink text-xs">
                <Text className="opacity-60">#</Text>
                {slug}
              </Text>
              <Feather name="x" size={12} color={tokens["accent-ink"]} />
            </Pressable>
          ))}
          {activeTags.length > 1 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="clear all tags"
              onPress={clearAll}
              className="px-2 py-1"
            >
              <Text className="text-muted text-xs italic">clear all</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {showPills ? (
        <View className="flex-row flex-wrap gap-1.5 mt-4">
          {PILLS.map((p) => {
            const isOn = p.key === activeFilter;
            return (
              <Link key={p.key} href={p.href} asChild>
                <Pressable accessibilityRole="link" className={pillClass(isOn)}>
                  <Text className={pillText(isOn)}>{p.label}</Text>
                </Pressable>
              </Link>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function pillClass(active: boolean): string {
  return active
    ? "px-3 py-1.5 rounded-full bg-accent-soft border border-transparent"
    : "px-3 py-1.5 rounded-full border border-border";
}

function pillText(active: boolean): string {
  return active ? "text-accent-ink text-sm font-medium" : "text-muted text-sm";
}
