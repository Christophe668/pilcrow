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
  // On phone the FAB's parent View's bottom edge is already at the TabBar's
  // top edge (TabBar lives in the AppLayout, one level up, and applies its
  // own safe-area padding internally), so a small fixed offset puts the
  // FAB just above the TabBar. On tablet/desktop there's no TabBar — the
  // parent runs to the screen bottom and we have to clear the gesture pill
  // ourselves.
  const bottomOffset = breakpoint === "phone" ? 16 : insets.bottom + 24;
  return (
    <Link href={ADD_ROUTE} asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="add article"
        className="absolute right-6 w-14 h-14 rounded-full bg-accent items-center justify-center shadow-lg"
        style={{ bottom: bottomOffset }}
      >
        <Feather name="plus" size={26} color="#ffffff" />
      </Pressable>
    </Link>
  );
}
