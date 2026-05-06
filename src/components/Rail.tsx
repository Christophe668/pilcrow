import { Pressable, ScrollView, Text, View } from "react-native";
import { Link, useSegments } from "expo-router";
import type { Href } from "expo-router";
import { useTags } from "@/hooks/useTags";

const FILTERS = [
  { route: "/(app)/(library)" as Href, label: "Unread", segment: "index" },
  { route: "/(app)/(library)/starred" as Href, label: "Starred", segment: "starred" },
  { route: "/(app)/(library)/archive" as Href, label: "Archive", segment: "archive" },
  { route: "/(app)/(library)/all" as Href, label: "All", segment: "all" },
] as const;

export function Rail() {
  const segments = useSegments() as string[];
  const tags = useTags();

  return (
    <ScrollView className="bg-bg" contentContainerClassName="px-6 py-8">
      <View className="mb-6">
        <Text className="font-mono text-subtle uppercase text-[10px] tracking-widest mb-2 px-2">
          Library
        </Text>
        {FILTERS.map((f) => {
          const isActive =
            (f.segment === "index" && segments[segments.length - 1] === "(library)") ||
            segments.includes(f.segment);
          return (
            <Link key={f.label} href={f.route} asChild>
              <Pressable className={`px-2 py-1.5 rounded-md ${isActive ? "bg-accent-soft" : ""}`}>
                <Text
                  className={isActive ? "text-accent-ink text-sm font-medium" : "text-fg text-sm"}
                >
                  {f.label}
                </Text>
              </Pressable>
            </Link>
          );
        })}
      </View>
      <View>
        <Text className="font-mono text-subtle uppercase text-[10px] tracking-widest mb-2 px-2">
          Tags
        </Text>
        {(tags.data ?? []).slice(0, 30).map((t) => {
          const isActive = segments.includes(t.slug);
          return (
            <Link key={t.id} href={`/(app)/(library)/tags/${t.slug}` as Href} asChild>
              <Pressable className={`px-2 py-1.5 rounded-md ${isActive ? "bg-accent-soft" : ""}`}>
                <Text className={isActive ? "text-accent-ink text-sm" : "text-fg text-sm"}>
                  #{t.label}
                </Text>
              </Pressable>
            </Link>
          );
        })}
      </View>
    </ScrollView>
  );
}
