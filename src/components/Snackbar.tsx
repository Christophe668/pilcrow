import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { dismissSnackbar, subscribeSnackbar, type SnackbarItem } from "./snackbar-store";

export function Snackbar() {
  const [item, setItem] = useState<SnackbarItem | null>(null);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    return subscribeSnackbar(setItem);
  }, []);

  if (!item) return null;
  return (
    <View
      pointerEvents="box-none"
      className="absolute left-0 right-0 items-center px-4"
      style={{ bottom: insets.bottom + 80 }}
    >
      <View className="flex-row items-center gap-3 bg-fg rounded-full px-4 py-2.5 shadow-lg max-w-[420px]">
        <Text className="text-bg text-sm flex-1">{item.message}</Text>
        {item.action ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.action.label}
            onPress={() => {
              item.action!.onPress();
              dismissSnackbar();
            }}
            className="px-2 py-1"
          >
            <Text className="text-accent text-sm font-medium uppercase tracking-wider">
              {item.action.label}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
