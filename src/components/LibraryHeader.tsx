import { Text, View } from "react-native";

export function LibraryHeader({ title, count }: { title: string; count?: number }) {
  return (
    <View className="px-6 pt-12 pb-3 border-b border-border">
      <View className="flex-row items-baseline justify-between">
        <Text className="font-display text-fg text-3xl">{title}</Text>
        {typeof count === "number" ? (
          <Text className="text-muted text-sm tabular-nums">{count}</Text>
        ) : null}
      </View>
    </View>
  );
}
