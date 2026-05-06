import { Text, View } from "react-native";

export function TagChip({ label }: { label: string }) {
  return (
    <View className="px-2 py-0.5 border border-border bg-surface rounded-full mr-1.5">
      <Text className="text-muted text-xs">{label}</Text>
    </View>
  );
}
