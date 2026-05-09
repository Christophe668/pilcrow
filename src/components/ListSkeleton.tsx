import { View } from "react-native";

/**
 * Static placeholder rows shown while the article list loads. Mirrors the
 * card layout — square thumbnail, two title-shapes, a few muted body lines
 * — so the eventual real cards land in the same horizontal rhythm. No
 * shimmer, just rules.
 */
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <View className="px-6 py-3">
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} className="flex-row gap-4 py-5 border-b border-border">
          <View className="w-16 h-16 rounded-md bg-border opacity-50" />
          <View className="flex-1">
            <View className="h-4 w-[88%] rounded-sm bg-border opacity-60 mb-2" />
            <View className="h-4 w-[64%] rounded-sm bg-border opacity-60 mb-3" />
            <View className="h-3 w-[92%] rounded-sm bg-border opacity-40 mb-1" />
            <View className="h-3 w-[80%] rounded-sm bg-border opacity-40 mb-2" />
            <View className="h-3 w-[40%] rounded-sm bg-border opacity-30" />
          </View>
        </View>
      ))}
    </View>
  );
}
