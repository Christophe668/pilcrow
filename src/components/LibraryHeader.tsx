import { Pressable, Text, View } from "react-native";
import { Link, type Href } from "expo-router";

export type LibraryFilter = "unread" | "starred" | "archive" | "all" | "tag" | "search";

type PillDef = {
  key: LibraryFilter;
  label: string;
  href: Href;
};

const PILLS: readonly PillDef[] = [
  { key: "unread", label: "Unread", href: "/(app)/(library)" as Href },
  { key: "starred", label: "Starred", href: "/(app)/(library)/starred" as Href },
  { key: "archive", label: "Archive", href: "/(app)/(library)/archive" as Href },
  { key: "all", label: "All", href: "/(app)/(library)/all" as Href },
];

export type LibraryHeaderProps = {
  title: string;
  count?: number;
  activeFilter?: LibraryFilter;
};

export function LibraryHeader({ title, count, activeFilter }: LibraryHeaderProps) {
  return (
    <View className="px-6 pt-12 pb-3 border-b border-border">
      <View className="flex-row items-baseline justify-between">
        <Text className="font-display text-fg text-3xl">{title}</Text>
        {typeof count === "number" ? (
          <Text className="text-muted text-sm tabular-nums">{count}</Text>
        ) : null}
      </View>
      {activeFilter ? (
        <View className="flex-row flex-wrap gap-1.5 mt-3">
          {PILLS.map((p) => {
            const isOn = p.key === activeFilter;
            const className = isOn
              ? "px-3 py-1.5 rounded-full border border-border bg-surface"
              : "px-3 py-1.5 rounded-full border border-transparent";
            const textClass = isOn ? "text-fg text-sm" : "text-muted text-sm";
            return (
              <Link key={p.key} href={p.href} asChild>
                <Pressable accessibilityRole="link" className={className}>
                  <Text className={textClass}>{p.label}</Text>
                </Pressable>
              </Link>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}
