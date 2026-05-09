import { Pressable } from "react-native";
import { Link } from "expo-router";
import type { Href } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBreakpoint } from "@/hooks/useResponsive";

const ADD_ROUTE = "/(app)/add" as Href;

export function FabAdd() {
  const insets = useSafeAreaInsets();
  const breakpoint = useBreakpoint();
  // On phone we sit clear of the bottom TabBar (≈56px tall + safe-area). On
  // tablet/desktop the TabBar isn't rendered, so the FAB drops to a small
  // breathing offset above the gesture pill.
  const tabBarClearance = breakpoint === "phone" ? 80 : 24;
  return (
    <Link href={ADD_ROUTE} asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="add article"
        className="absolute right-6 w-14 h-14 rounded-full bg-accent items-center justify-center shadow-lg"
        style={{ bottom: insets.bottom + tabBarClearance }}
      >
        <Feather name="plus" size={26} color="#ffffff" />
      </Pressable>
    </Link>
  );
}
