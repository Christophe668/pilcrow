import { Slot, useSegments } from "expo-router";
import { View } from "react-native";
import { TabBar } from "@/components/TabBar";
import { useBreakpoint } from "@/hooks/useResponsive";

export default function AppLayout() {
  const breakpoint = useBreakpoint();
  const segments = useSegments() as string[];
  const inArticle = segments.includes("article");
  const showTabBar = breakpoint === "phone" && !inArticle;
  return (
    <View className="flex-1 bg-bg">
      <View className="flex-1">
        <Slot />
      </View>
      {showTabBar ? <TabBar /> : null}
    </View>
  );
}
