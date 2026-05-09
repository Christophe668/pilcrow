import { Pressable, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTokens } from "@/theme/provider";
import { formatRelative } from "@/lib/time";

export type ArticleMode = "reader" | "live";

export type ArticleHeaderProps = {
  title: string | null;
  domain: string | null;
  readingTimeMin: number | null;
  savedAt: string | null;
  /** When `null`, the segmented control is hidden (extraction succeeded and
   * the user hasn't asked to view live). When set, the segmented control
   * replaces the title row and the user can swap modes. */
  mode: ArticleMode | null;
  onChangeMode: (mode: ArticleMode) => void;
  onBack: () => void;
  onOpenOriginal: () => void;
  onOpenPrefs: () => void;
};

/**
 * Editorial-style chrome for the article reader. Top row is the navigation
 * triad — back, prefs, open-original. Below it sits the title in display
 * serif (or a Reader/Live segmented control when extraction failed or the
 * user is viewing the live page). No URL in the body — that affordance lives
 * in the open-original icon.
 */
export function ArticleHeader(props: ArticleHeaderProps) {
  const insets = useSafeAreaInsets();
  const tokens = useTokens();
  const meta = formatMeta(props.domain, props.readingTimeMin, props.savedAt);
  return (
    <View className="bg-bg items-center border-b border-border">
      <View className="w-full max-w-[680px] px-5" style={{ paddingTop: insets.top + 10 }}>
        <View className="flex-row items-center justify-between py-1">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="back"
            onPress={props.onBack}
            hitSlop={10}
            className="px-2 py-1.5 -ml-2"
          >
            <Feather name="chevron-left" size={22} color={tokens.muted} />
          </Pressable>
          <View className="flex-row items-center gap-1">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="reader preferences"
              onPress={props.onOpenPrefs}
              hitSlop={10}
              className="px-3 py-1.5"
            >
              {/* "Aa" reads better than any glyph here — a literal sample
                  of the type controls. Keep as text but tune the metrics. */}
              <Text className="font-display text-fg" style={{ fontSize: 17, lineHeight: 20 }}>
                Aa
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="open original article"
              onPress={props.onOpenOriginal}
              hitSlop={10}
              className="px-2 py-1.5 -mr-2"
            >
              <Feather name="external-link" size={18} color={tokens.muted} />
            </Pressable>
          </View>
        </View>

        {props.mode ? (
          <ModeSegmented mode={props.mode} onChange={props.onChangeMode} />
        ) : (
          <View className="pt-3 pb-4">
            {props.title ? (
              <Text
                className="font-display text-fg"
                style={{ fontSize: 22, lineHeight: 27, fontWeight: "500" }}
                numberOfLines={2}
              >
                {props.title}
              </Text>
            ) : null}
            {meta ? (
              <Text className="text-muted text-xs mt-1.5" numberOfLines={1}>
                {meta}
              </Text>
            ) : null}
          </View>
        )}
      </View>
    </View>
  );
}

function ModeSegmented({
  mode,
  onChange,
}: {
  mode: ArticleMode;
  onChange: (mode: ArticleMode) => void;
}) {
  return (
    <View className="py-3 items-center">
      <View className="flex-row rounded-full border border-border p-0.5 bg-surface">
        <SegmentButton
          label="Reader"
          active={mode === "reader"}
          onPress={() => onChange("reader")}
        />
        <SegmentButton label="Live" active={mode === "live"} onPress={() => onChange("live")} />
      </View>
    </View>
  );
}

function SegmentButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      className={active ? "px-4 py-1.5 rounded-full bg-fg" : "px-4 py-1.5 rounded-full"}
    >
      <Text
        className={active ? "text-bg text-xs font-medium" : "text-muted text-xs"}
        style={{ letterSpacing: 0.4 }}
      >
        {label.toUpperCase()}
      </Text>
    </Pressable>
  );
}

function formatMeta(
  domain: string | null,
  readingTimeMin: number | null,
  savedAt: string | null,
): string | null {
  const parts: string[] = [];
  if (domain) parts.push(domain);
  if (readingTimeMin && readingTimeMin > 0) parts.push(`${readingTimeMin} min`);
  const rel = formatRelative(savedAt);
  if (rel) parts.push(`saved ${rel}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}
