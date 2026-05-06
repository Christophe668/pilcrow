import { Text, View } from "react-native";

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <View className="flex-1 items-center justify-center px-12 py-24">
      <Text className="font-display text-fg text-2xl text-center mb-2">{title}</Text>
      {description ? (
        <Text className="text-muted text-sm text-center max-w-sm">{description}</Text>
      ) : null}
    </View>
  );
}
