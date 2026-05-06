import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCreateEntry } from "@/hooks/useCreateEntry";
import { extractCandidateUrl } from "@/lib/url";

export default function AddRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ url?: string; tags?: string }>();
  const initialUrl = extractCandidateUrl(params.url) ?? "";
  const initialTags = (params.tags ?? "").trim();

  const [url, setUrl] = useState(initialUrl);
  const [tagsText, setTagsText] = useState(initialTags);
  const [error, setError] = useState<string | null>(null);

  const create = useCreateEntry();

  const onSave = async () => {
    setError(null);
    const candidate = extractCandidateUrl(url);
    if (!candidate) {
      setError("That doesn't look like a URL. Make sure it starts with http(s)://.");
      return;
    }
    const tags = tagsText
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    try {
      await create.mutateAsync({ url: candidate, tags });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    }
  };

  return (
    <View className="flex-1 bg-bg items-center px-6 pt-16">
      <View className="w-full max-w-[560px]">
        <View className="flex-row items-baseline justify-between mb-6">
          <Text className="font-display text-fg text-3xl">Save article</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.back()}
            className="px-2 py-1.5"
          >
            <Text className="text-muted text-sm">Cancel</Text>
          </Pressable>
        </View>

        <Text className="text-fg text-sm mb-2">URL</Text>
        <TextInput
          value={url}
          onChangeText={setUrl}
          placeholder="https://example.com/article"
          placeholderTextColor="#888"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          autoFocus
          className="border border-border bg-surface text-fg rounded-md px-3 py-3 mb-4"
        />

        <Text className="text-fg text-sm mb-2">Tags (comma separated, optional)</Text>
        <TextInput
          value={tagsText}
          onChangeText={setTagsText}
          placeholder="ai, dev"
          placeholderTextColor="#888"
          autoCapitalize="none"
          autoCorrect={false}
          className="border border-border bg-surface text-fg rounded-md px-3 py-3"
        />

        {error ? <Text className="text-accent text-sm mt-3">{error}</Text> : null}

        <Pressable
          accessibilityRole="button"
          disabled={create.isPending}
          onPress={onSave}
          className="bg-accent rounded-md py-3 mt-6 items-center"
        >
          {create.isPending ? (
            <ActivityIndicator />
          ) : (
            <Text className="text-white font-medium">Save</Text>
          )}
        </Pressable>

        <Text className="text-subtle text-xs mt-4 text-center">
          The article goes into your unread list. Wallabag fetches the body in the background;
          you&apos;ll see it once sync catches up.
        </Text>
      </View>
    </View>
  );
}
