import { ActivityIndicator, Pressable, Share, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useToggleStarred } from "@/hooks/useToggleStarred";
import { useToggleArchived } from "@/hooks/useToggleArchived";
import { useDeleteArticle } from "@/hooks/useDeleteArticle";

export type ActionBarProps = {
  articleId: number;
  url: string;
  title: string | null;
  isStarred: boolean;
  isArchived: boolean;
  onOpenPrefs?: () => void;
};

export function ActionBar(props: ActionBarProps) {
  const router = useRouter();
  const star = useToggleStarred();
  const archive = useToggleArchived();
  const del = useDeleteArticle();

  const onShare = async () => {
    await Share.share({ url: props.url, message: props.url, title: props.title ?? props.url });
  };

  const onDelete = async () => {
    await del.mutateAsync(props.articleId);
    router.back();
  };

  return (
    <View className="flex-row items-center justify-between px-6 py-3 border-t border-border bg-surface">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={props.isStarred ? "unstar" : "star"}
        onPress={() => star.mutate({ id: props.articleId, starred: !props.isStarred })}
        className="px-2 py-1.5"
      >
        <Text className={props.isStarred ? "text-accent text-lg" : "text-fg text-lg"}>
          {props.isStarred ? "★" : "☆"}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={props.isArchived ? "unarchive" : "archive"}
        onPress={() => archive.mutate({ id: props.articleId, archived: !props.isArchived })}
        className="px-2 py-1.5"
      >
        <Text className={props.isArchived ? "text-accent text-sm" : "text-fg text-sm"}>
          {props.isArchived ? "Unarchive" : "Archive"}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="share"
        onPress={onShare}
        className="px-2 py-1.5"
      >
        <Text className="text-fg text-sm">Share</Text>
      </Pressable>
      {props.onOpenPrefs ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="reader preferences"
          onPress={props.onOpenPrefs}
          className="px-2 py-1.5"
        >
          <Text className="text-fg text-sm">Aa</Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="delete"
        onPress={onDelete}
        className="px-2 py-1.5"
      >
        {del.isPending ? <ActivityIndicator /> : <Text className="text-muted text-sm">Delete</Text>}
      </Pressable>
    </View>
  );
}
