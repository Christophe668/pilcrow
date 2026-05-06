import { Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useArticle } from "@/hooks/useArticle";

export default function ArticlePlaceholder() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const articleId = Number(id);
  const article = useArticle(articleId);

  return (
    <ScrollView className="flex-1 bg-bg">
      <View className="px-6 pt-12 pb-3 border-b border-border flex-row items-center gap-3">
        <Pressable accessibilityRole="button" onPress={() => router.back()}>
          <Text className="text-accent text-base">← Back</Text>
        </Pressable>
      </View>
      <View className="px-6 py-8">
        <Text className="font-display text-fg text-3xl mb-3">
          {article.data?.title ?? article.data?.url ?? "Loading..."}
        </Text>
        <Text className="text-muted text-sm mb-6">{article.data?.url}</Text>
        <Text className="text-fg text-sm">
          The reader is coming in Phase 4. For now this is a placeholder showing the article title
          and URL. Tap Back to return to the library.
        </Text>
      </View>
    </ScrollView>
  );
}
