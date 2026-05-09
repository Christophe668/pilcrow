import { Text, View } from "react-native";

/**
 * In-list section divider used between time-grouped article cards. The type
 * weight is intentionally light — mono uppercase tracked, accent-tinted —
 * so it reads as an editorial section break, not as a heading. A short
 * accent rule above echoes the column-rule treatment in the article reader.
 */
export function SectionDivider({ label, first }: { label: string; first?: boolean }) {
  return (
    <View className="px-6" style={{ paddingTop: first ? 18 : 28, paddingBottom: 6 }}>
      <View className="h-[1.5px] w-8 bg-accent mb-2 rounded-full" />
      <Text
        className="font-mono text-muted uppercase"
        style={{ fontSize: 10.5, letterSpacing: 1.6 }}
      >
        {label}
      </Text>
    </View>
  );
}
