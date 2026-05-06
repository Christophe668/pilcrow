import React, { useState } from "react";
import { Linking, Platform, Pressable, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";

function bookmarkletJs(origin: string): string {
  const target = origin.replace(/\/+$/, "");
  return `javascript:(()=>{location.href='${target}/add?url='+encodeURIComponent(location.href)})();`;
}

export function BookmarkletCard() {
  const isWeb = Platform.OS === "web";
  const origin =
    isWeb && typeof window !== "undefined"
      ? window.location.origin
      : "https://your-wallabag-app.example";
  const js = bookmarkletJs(origin);
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    await Clipboard.setStringAsync(js);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const dragLink = isWeb
    ? React.createElement(
        "a",
        {
          href: js,
          onClick: (e: { preventDefault: () => void }) => e.preventDefault(),
          draggable: true,
          style: {
            display: "inline-block",
            padding: "6px 10px",
            border: "1px solid currentColor",
            borderRadius: 6,
            color: "var(--color-accent)",
            textDecoration: "none",
            fontSize: 13,
            cursor: "grab",
            marginBottom: 8,
          },
        },
        "+ Save to wallabag",
      )
    : null;

  return (
    <View className="border border-border bg-surface rounded-md px-4 py-3">
      <Text className="text-fg text-sm mb-1">Save from your browser</Text>
      <Text className="text-muted text-xs mb-3">
        {isWeb
          ? "Drag the link below to your bookmarks bar. On any web page, click it and the URL gets saved here."
          : "Open the web app in a browser to set up the bookmarklet."}
      </Text>

      {dragLink}

      <View className="flex-row gap-2 items-center">
        <Pressable
          accessibilityRole="button"
          onPress={onCopy}
          className="px-3 py-1.5 rounded-md border border-border"
        >
          <Text className="text-fg text-xs">{copied ? "Copied!" : "Copy bookmarklet code"}</Text>
        </Pressable>
        {!isWeb ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => Linking.openURL(origin)}
            className="px-3 py-1.5 rounded-md border border-border"
          >
            <Text className="text-fg text-xs">Open web app</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
