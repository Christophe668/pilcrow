import { Pressable, Text, View } from "react-native";
import { useRouter, useSegments } from "expo-router";
import type { Href } from "expo-router";

const TABS = [
  { route: "/(app)/(library)" as Href, label: "Library", segment: "(library)" },
  { route: "/(app)/add" as Href, label: "+", segment: "add" },
  { route: "/(app)/(library)/search" as Href, label: "Search", segment: "search" },
  { route: "/(app)/settings" as Href, label: "Settings", segment: "settings" },
] as const;

export function TabBar() {
  const router = useRouter();
  const segments = useSegments() as string[];
  return (
    <View className="flex-row border-t border-border bg-surface">
      {TABS.map((tab) => {
        const isActive =
          (tab.segment === "(library)" &&
            segments.includes("(library)") &&
            !segments.includes("search")) ||
          segments.includes(tab.segment);
        return (
          <Pressable
            key={tab.label}
            accessibilityRole="button"
            onPress={() => router.replace(tab.route)}
            className="flex-1 items-center py-3"
          >
            <Text className={isActive ? "text-accent text-sm font-medium" : "text-muted text-sm"}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
