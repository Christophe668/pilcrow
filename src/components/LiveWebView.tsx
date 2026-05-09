import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTokens } from "@/theme/provider";

export type LiveWebViewProps = {
  url: string;
};

/**
 * Renders the live web page for a URL with JavaScript enabled. Used as a
 * fallback when Wallabag's server-side fetcher couldn't extract readable
 * content (x.com, Cloudflare-gated pages, paywalls). On web we can't
 * iframe most of the sites that need this — X-Frame-Options blocks them —
 * so the web variant degrades to a clear handoff card pointing at the
 * system browser instead of pretending to load something.
 */
export function LiveWebView({ url }: LiveWebViewProps) {
  if (Platform.OS === "web") {
    return <WebFallback url={url} />;
  }
  return <NativeLiveWebView url={url} />;
}

function WebFallback({ url }: { url: string }) {
  const tokens = useTokens();
  return (
    <View className="flex-1 items-center justify-center px-8">
      <View className="w-full max-w-[420px] items-center">
        <Text className="font-display text-fg text-xl text-center mb-2">
          Live page is mobile-only
        </Text>
        <Text className="text-muted text-sm text-center mb-6">
          Browsers block embedding most of the sites that need this fallback. Open it in a new tab
          instead.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => void Linking.openURL(url).catch(() => undefined)}
          className="flex-row items-center justify-center bg-fg rounded-md px-5 py-3"
        >
          <Feather name="external-link" size={16} color={tokens.bg} />
          <Text className="text-bg font-medium ml-2">Open original</Text>
        </Pressable>
      </View>
    </View>
  );
}

function NativeLiveWebView({ url }: { url: string }) {
  const tokens = useTokens();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Belt-and-suspenders timeout: heavy SPAs (x.com, ad-laden news sites)
  // can spin forever because their analytics never quiet down. Once we've
  // waited 5 seconds, dismiss the spinner regardless — whatever the
  // WebView has rendered by then is what the user is going to get.
  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => setLoading(false), 5000);
    return () => clearTimeout(t);
  }, [loading]);

  // Lazy-require so the web bundle never tries to resolve the native
  // module.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { WebView } = require("react-native-webview") as typeof import("react-native-webview");

  return (
    <View className="flex-1 bg-bg">
      <WebView
        source={{ uri: url }}
        // A solid background is important on Android — transparent
        // backgrounds occasionally suppress load callbacks on the system
        // WebView, leaving the loader stuck.
        style={{ flex: 1, backgroundColor: tokens.bg }}
        javaScriptEnabled
        domStorageEnabled
        thirdPartyCookiesEnabled
        sharedCookiesEnabled
        // Most JS-gated sites detect the default RN WebView UA as a bot.
        // A standard mobile Chrome UA gets the real content.
        userAgent={
          "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) " +
          "Chrome/124.0.0.0 Mobile Safari/537.36"
        }
        onLoadEnd={() => setLoading(false)}
        onError={(e) => {
          setLoading(false);
          setError(e.nativeEvent.description ?? "Failed to load");
        }}
        onHttpError={(e) => {
          setLoading(false);
          setError(`HTTP ${e.nativeEvent.statusCode}`);
        }}
      />
      {loading ? (
        <View
          className="absolute left-0 right-0 top-0 bottom-0 items-center justify-center"
          style={{ backgroundColor: tokens.bg }}
          pointerEvents="none"
        >
          <ActivityIndicator />
          <Text className="text-muted text-xs mt-3">Loading live page…</Text>
        </View>
      ) : null}
      {error ? (
        <View
          className="absolute left-0 right-0 top-0 bottom-0 items-center justify-center px-8"
          style={{ backgroundColor: tokens.bg }}
        >
          <Text className="font-display text-fg text-xl text-center mb-2">
            {"Couldn't load this page"}
          </Text>
          <Text className="text-muted text-sm text-center mb-6">{error}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void Linking.openURL(url).catch(() => undefined)}
            className="bg-fg rounded-md px-5 py-3"
          >
            <Text className="text-bg font-medium">Open in browser</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
