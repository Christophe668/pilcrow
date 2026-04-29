import { Pressable, View } from "react-native";
import { useRouter, useSegments } from "expo-router";
import type { Href } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTokens } from "@/theme/provider";

type FeatherIconName = React.ComponentProps<typeof Feather>["name"];

type Tab = {
  route: Href;
  segment: string;
  icon: FeatherIconName;
  label: string;
};

const TABS: readonly Tab[] = [
  {
    route: "/(app)/(library)" as Href,
    segment: "(library)",
    icon: "book-open",
    label: "Library",
  },
  {
    route: "/(app)/(library)/search" as Href,
    segment: "search",
    icon: "search",
    label: "Search",
  },
  {
    route: "/(app)/settings" as Href,
    segment: "settings",
    icon: "settings",
    label: "Settings",
  },
];

export function TabBar() {
  const router = useRouter();
  const segments = useSegments() as string[];
  const insets = useSafeAreaInsets();
  const tokens = useTokens();
  return (
    <View
      className="flex-row border-t border-border bg-surface"
      style={{ paddingBottom: insets.bottom }}
    >
      {TABS.map((tab) => {
        // The library tab matches when we're under /(library) but not on
        // /search (which lives under the same segment group). Branch
        // explicitly — the previous `|| segments.includes(tab.segment)`
        // fall-through always re-activated Library on /search because
        // `(library)` is still in the segment list.
        const isActive =
          tab.segment === "(library)"
            ? segments.includes("(library)") && !segments.includes("search")
            : segments.includes(tab.segment);
        const color = isActive ? tokens.accent : tokens.muted;
        return (
          <Pressable
            key={tab.label}
            accessibilityRole="button"
            accessibilityLabel={tab.label}
            onPress={() => router.replace(tab.route)}
            className="flex-1 items-center py-3"
          >
            <Feather name={tab.icon} size={22} color={color} />
          </Pressable>
        );
      })}
    </View>
  );
}
