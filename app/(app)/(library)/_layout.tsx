import { Slot } from "expo-router";
import { View } from "react-native";
import { Rail } from "@/components/Rail";
import { FabAdd } from "@/components/FabAdd";
import { useBreakpoint } from "@/hooks/useResponsive";

export default function LibraryLayout() {
  const breakpoint = useBreakpoint();
  const showRail = breakpoint !== "phone";
  // Rail widens from 200px on tablet to 240px on desktop. The list pane is
  // flex-1 with min-w-0 so it actually shrinks when the window does. No
  // overall max-width cap — the library fills the entire window so resize
  // is fluid and there are no large empty margins on wide displays.
  const railWidth = breakpoint === "desktop" ? "w-[240px]" : "w-[200px]";
  return (
    <View className="flex-1 bg-bg flex-row">
      {showRail ? (
        <View className={`${railWidth} border-r border-border`}>
          <Rail />
        </View>
      ) : null}
      <View className="flex-1 min-w-0">
        <Slot />
        <FabAdd />
      </View>
    </View>
  );
}
