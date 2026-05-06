import { Text, View } from "react-native";

export function EmptyState({
  title,
  description,
  glyph = "✦",
}: {
  title: string;
  description?: string;
  glyph?: string;
}) {
  return (
    <View className="flex-1 items-center justify-center px-12 py-24">
      <View className="w-20 h-20 rounded-full bg-accent-soft items-center justify-center mb-6">
        <Text className="text-3xl text-accent-ink">{glyph}</Text>
      </View>
      <Text className="font-display text-fg text-2xl text-center mb-2">{title}</Text>
      {description ? (
        <Text className="text-muted text-sm text-center max-w-sm leading-relaxed">
          {description}
        </Text>
      ) : null}
    </View>
  );
}
