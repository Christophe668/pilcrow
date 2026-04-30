import { Platform, Pressable, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTokens } from "@/theme/provider";

export type OverflowItem = {
  key: string;
  label: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  destructive?: boolean;
  onPress: () => void;
};

export type OverflowSheetProps = {
  visible: boolean;
  items: OverflowItem[];
  onClose: () => void;
};

/**
 * Bottom sheet for rare or destructive actions. Implemented as a plain
 * absolute-positioned overlay rather than React Native's `Modal` because
 * `Modal` on react-native-web uses `position: fixed`, which gets confined
 * to the nearest transformed ancestor — and react-native-screens wraps
 * each route in a transformed container. The result was a "modal" that
 * couldn't cover the full screen and the page's bottom action bar bled
 * through. Rendering as an `absolute inset-0` sibling of the route's
 * `flex-1` root sidesteps all of that.
 *
 * The component MUST be mounted at the route's top level, not inside
 * the action bar — otherwise the absolute positioning would be confined
 * to the action bar's box.
 */
export function OverflowSheet({ visible, items, onClose }: OverflowSheetProps) {
  const insets = useSafeAreaInsets();
  const tokens = useTokens();
  if (!visible) return null;
  return (
    <View
      // Cover the route. Renders above all sibling content thanks to
      // mount order; for safety on Android we also bump zIndex/elevation.
      className="absolute left-0 right-0 top-0 bottom-0 justify-end"
      style={{ zIndex: 100, elevation: 100 }}
    >
      {/* Backdrop — captures dismiss taps. Sized to the entire overlay so
          tapping anywhere outside the sheet closes it. */}
      <Pressable
        accessibilityLabel="dismiss"
        onPress={onClose}
        className="absolute left-0 right-0 top-0 bottom-0"
        style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
      />
      {/* Sheet — capped width on tablet/desktop so it doesn't stretch into
          a banner; rounded top corners and a soft shadow give it the
          "free-floating card" reading you'd expect from a sheet. */}
      <View
        className="self-center w-full max-w-[480px] bg-surface border-t border-border"
        style={{
          paddingBottom: insets.bottom + 8,
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
          ...(Platform.OS === "web"
            ? { boxShadow: "0 -8px 24px rgba(0,0,0,0.18)" as never }
            : {
                shadowColor: "#000",
                shadowOffset: { width: 0, height: -4 },
                shadowOpacity: 0.18,
                shadowRadius: 16,
                elevation: 12,
              }),
        }}
      >
        <View className="items-center pt-2.5 pb-1">
          <View className="w-10 h-1 rounded-full bg-border-strong" />
        </View>
        <View className="py-1">
          {items.map((item, i) => (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              onPress={() => {
                onClose();
                // Defer slightly so the sheet unmounts before the action
                // triggers a navigation — avoids visual flicker.
                setTimeout(item.onPress, 0);
              }}
              className={
                i === 0
                  ? "flex-row items-center px-5 py-4 hover:bg-surface-2 active:bg-surface-2"
                  : "flex-row items-center px-5 py-4 border-t border-border hover:bg-surface-2 active:bg-surface-2"
              }
            >
              <View className="w-7 items-center">
                <Feather
                  name={item.icon}
                  size={18}
                  color={item.destructive ? tokens.accent : tokens.fg}
                />
              </View>
              <Text
                className={
                  item.destructive
                    ? "text-accent text-base ml-3 font-medium"
                    : "text-fg text-base ml-3"
                }
              >
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}
