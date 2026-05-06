import { Slot } from "expo-router";
import { View } from "react-native";
import { Rail } from "@/components/Rail";
import { FabAdd } from "@/components/FabAdd";
import { useBreakpoint } from "@/hooks/useResponsive";

export default function LibraryLayout() {
  const breakpoint = useBreakpoint();
  const showRail = breakpoint !== "phone";
  // Match the prototype's responsive rail widths: 212px below 1280, 240px above.
  const railWidth = breakpoint === "desktop" ? "w-[240px]" : "w-[200px]";
  return (
    <View className="flex-1 bg-bg items-center">
      <View className="flex-1 flex-row w-full max-w-[1480px]">
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
    </View>
  );
}
