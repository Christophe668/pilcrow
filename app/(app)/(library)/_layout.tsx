import { Slot } from "expo-router";
import { View } from "react-native";
import { Rail } from "@/components/Rail";
import { FabAdd } from "@/components/FabAdd";
import { useBreakpoint } from "@/hooks/useResponsive";

export default function LibraryLayout() {
  const breakpoint = useBreakpoint();
  const showRail = breakpoint !== "phone";
  return (
    <View className="flex-1 bg-bg items-center">
      <View className="flex-1 flex-row w-full max-w-[1480px] border-x border-border">
        {showRail ? (
          <View className="w-[240px] border-r border-border">
            <Rail />
          </View>
        ) : null}
        <View className="flex-1">
          <Slot />
          <FabAdd />
        </View>
      </View>
    </View>
  );
}
