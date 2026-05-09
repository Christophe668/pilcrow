import { Pressable, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTokens } from "@/theme/provider";

export type ExtractionFailedViewProps = {
  url: string;
  onOpenOriginal: () => void;
  /** When non-null, renders a primary "View live page" CTA that opens the
   * URL in an in-app WebView with JS enabled. Pass `null` on web, where
   * iframing cross-origin is blocked by X-Frame-Options on most sites that
   * need this fallback in the first place. */
  onViewLive: (() => void) | null;
  /** Ask the server to re-fetch and re-extract. Useful when the original
   * fetch landed on a transient gatekeeper page. */
  onReload?: () => void;
  /** True while the reload mutation is in flight, so we can disable + show
   * a spinner on the button. */
  reloading?: boolean;
  /** Override the detector and try to render whatever Wallabag stored.
   * Useful as an escape hatch when the user suspects a false positive. */
  onShowAnyway?: () => void;
};

/**
 * Editorial treatment of the failed-extraction state. The reader sets a
 * typographic standard the rest of the app should match — this surface
 * leans into that with a tracked-out display headline, an accent rule, and
 * the URL broken on its path separators in a monospace font as a visible
 * citation. It's a state the user sees rarely; on those occasions it should
 * feel deliberate, not apologetic.
 */
export function ExtractionFailedView({
  url,
  onOpenOriginal,
  onViewLive,
  onReload,
  reloading,
  onShowAnyway,
}: ExtractionFailedViewProps) {
  const tokens = useTokens();
  let host = url;
  let pathSegments: string[] = [];
  try {
    const parsed = new URL(url);
    host = parsed.host.replace(/^www\./, "");
    pathSegments = parsed.pathname.split("/").filter(Boolean);
  } catch {
    // keep raw url
  }
  return (
    <View className="flex-1 items-center justify-center px-6">
      <View className="w-full max-w-[520px]">
        <Text
          className="font-display text-fg"
          style={{
            fontSize: 44,
            lineHeight: 46,
            letterSpacing: -1,
            fontWeight: "500",
          }}
        >
          Extraction
        </Text>
        <Text
          className="font-display text-fg"
          style={{
            fontSize: 44,
            lineHeight: 46,
            letterSpacing: -1,
            fontWeight: "500",
          }}
        >
          failed.
        </Text>

        {/* Accent rule — short, like a magazine sub-rule. */}
        <View className="h-[2px] bg-accent w-12 mt-6 mb-6" />

        <Text className="text-muted text-base" style={{ lineHeight: 22 }}>
          <Text className="text-fg" style={{ fontStyle: "italic" }}>
            {host}
          </Text>{" "}
          returned only a placeholder. The page requires JavaScript to render its content, or it
          sits behind a login.
        </Text>

        <View className="mt-7 mb-7">
          {onViewLive ? (
            <>
              <Pressable
                accessibilityRole="button"
                onPress={onViewLive}
                className="bg-fg rounded-md px-5 py-3 items-center mb-3 flex-row justify-center"
              >
                <Feather name="globe" size={16} color={tokens.bg} />
                <Text className="text-bg font-medium ml-2">View live page</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={onOpenOriginal}
                className="px-5 py-3 items-center"
              >
                <Text className="text-muted text-sm">Open in browser instead</Text>
              </Pressable>
            </>
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={onOpenOriginal}
              className="bg-fg rounded-md px-5 py-3 items-center flex-row justify-center"
            >
              <Feather name="external-link" size={16} color={tokens.bg} />
              <Text className="text-bg font-medium ml-2">Open original</Text>
            </Pressable>
          )}
          {onReload ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !!reloading }}
              disabled={!!reloading}
              onPress={onReload}
              className="flex-row items-center justify-center px-5 py-3 mt-1"
            >
              <Feather
                name="refresh-cw"
                size={14}
                color={tokens.muted}
                style={reloading ? { opacity: 0.4 } : undefined}
              />
              <Text className="text-muted text-sm ml-2">
                {reloading ? "Re-extracting…" : "Try re-extracting from server"}
              </Text>
            </Pressable>
          ) : null}
          {onShowAnyway ? (
            <Pressable
              accessibilityRole="button"
              onPress={onShowAnyway}
              className="px-5 py-2 items-center mt-1"
            >
              <Text className="text-subtle text-xs italic">Show extracted content anyway</Text>
            </Pressable>
          ) : null}
        </View>

        {/* Citation: URL broken on path separators in mono — reads as a
            byline at the foot of an article. */}
        <View className="border-t border-border pt-3">
          <Text
            className="text-subtle"
            style={{
              fontFamily: "ui-monospace",
              fontSize: 11,
              lineHeight: 16,
            }}
            numberOfLines={3}
          >
            {host}
            {pathSegments.length > 0 ? "  /  " : ""}
            {pathSegments.join("  /  ")}
          </Text>
        </View>
      </View>
    </View>
  );
}
