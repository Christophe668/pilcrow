import { View } from "react-native";

/**
 * Static typographic placeholder shown while the article loads. No shimmer —
 * shimmer reads as cheap. Static rules read as deliberate, like a newspaper
 * front page where the type is set before the photo arrives. The widths are
 * randomised per render so it doesn't look like a uniform grid; we accept
 * that the placeholder reflows between mounts.
 */
export function ReaderSkeleton() {
  return (
    <View className="flex-1 items-center px-5 pt-6">
      <View className="w-full max-w-[680px]">
        {/* Title — three rule lengths, decreasing — mimics a balanced wrap. */}
        <View className="mb-2 h-9 w-[88%] rounded-sm bg-border opacity-70" />
        <View className="mb-2 h-9 w-[72%] rounded-sm bg-border opacity-70" />
        <View className="mb-6 h-9 w-[40%] rounded-sm bg-border opacity-70" />

        {/* Meta */}
        <View className="mb-8 h-3 w-[28%] rounded-sm bg-border opacity-50" />

        {/* Body — varied widths so it doesn't read like a barcode. */}
        {LINE_WIDTHS.map((w, i) => (
          <View
            key={i}
            className="mb-3 h-3 rounded-sm bg-border opacity-40"
            style={{ width: `${w}%` }}
          />
        ))}
      </View>
    </View>
  );
}

// Hand-tuned to feel like a justified prose paragraph: most lines fill, a few
// fall short, and one or two are visibly shorter to suggest paragraph breaks.
const LINE_WIDTHS = [
  96,
  94,
  91,
  97,
  88,
  65, // first paragraph
  95,
  92,
  98,
  86,
  72, // second
  94,
  96,
  90,
  60, // third (shorter — paragraph end)
];
