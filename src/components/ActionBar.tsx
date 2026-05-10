import { ActivityIndicator, Alert, Platform, Pressable, Share, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { showSnackbar } from "./snackbar-store";
import type { OverflowItem } from "./OverflowSheet";
import { useTokens } from "@/theme/provider";
import { useToggleStarred } from "@/hooks/useToggleStarred";
import { useToggleArchived } from "@/hooks/useToggleArchived";
import { useDeleteArticle } from "@/hooks/useDeleteArticle";
import { useReloadEntry } from "@/hooks/useReloadEntry";
import { goBackOrHome } from "@/lib/navigation";
import { getBackend } from "@/api/backend";

export type ActionBarProps = {
  articleId: number;
  url: string;
  title: string | null;
  isStarred: boolean;
  isArchived: boolean;
  /** Called by the More button. The host (article route) owns the
   * overflow sheet so it can render at the route's root level — required
   * because react-native-screens transforms break Modal positioning on
   * web. The host is responsible for showing the sheet with `items`. */
  onShowOverflow: (items: OverflowItem[]) => void;
};

/**
 * Bottom action bar for the article reader. Each cell is icon-over-label —
 * the icons give the row visual rhythm, the labels below remove the "what
 * does this do" guesswork that bare-icon bars always create on first
 * encounter. Hover state is wired via NativeWind so web/desktop users get
 * the affordance feedback native users get from press states.
 */
export function ActionBar(props: ActionBarProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tokens = useTokens();
  const star = useToggleStarred();
  const archive = useToggleArchived();
  const del = useDeleteArticle();
  const reload = useReloadEntry();

  const onShare = async () => {
    await Share.share({ url: props.url, message: props.url, title: props.title ?? props.url });
  };

  const onArchiveToggle = () => {
    const wasArchived = props.isArchived;
    archive.mutate({ id: props.articleId, archived: !wasArchived });
    showSnackbar({
      message: wasArchived ? "Restored" : "Archived",
      action: {
        label: "Undo",
        onPress: () => archive.mutate({ id: props.articleId, archived: wasArchived }),
      },
    });
  };

  const performDelete = async () => {
    await del.mutateAsync(props.articleId);
    showSnackbar({ message: "Deleted" });
    goBackOrHome(router);
  };

  const onDelete = () => {
    if (Platform.OS === "web") {
      // RN's Alert isn't available on web; fall back to confirm().
      // eslint-disable-next-line no-alert
      if (typeof window !== "undefined" && window.confirm("Delete this article?")) {
        void performDelete();
      }
      return;
    }
    Alert.alert(
      "Delete this article?",
      "It will be removed from this device and your Wallabag account.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => void performDelete() },
      ],
    );
  };

  const onReload = async () => {
    showSnackbar({ message: "Reloading from server…" });
    try {
      await reload.mutateAsync(props.articleId);
      showSnackbar({ message: "Reloaded" });
    } catch (e) {
      // Don't snack on session expiry — signOut already fired and the
      // auth gate will redirect to /(auth)/server. A "Reload failed"
      // toast on top of that is just noise.
      if (e instanceof Error && e.name === "SessionExpiredError") return;
      showSnackbar({
        message: e instanceof Error ? `Reload failed: ${e.message}` : "Reload failed",
      });
    }
  };

  const showOverflow = () => {
    const items: OverflowItem[] = [];
    // Hide the reload affordance when the active backend doesn't
    // support it (Readeck has no equivalent endpoint).
    if (getBackend().capabilities.reloadArticle) {
      items.push({
        key: "reload",
        label: "Reload from server",
        icon: "refresh-cw",
        onPress: onReload,
      });
    }
    items.push({
      key: "delete",
      label: "Delete article",
      icon: "trash-2",
      destructive: true,
      onPress: onDelete,
    });
    props.onShowOverflow(items);
  };

  return (
    <View
      className="border-t border-border bg-surface items-center"
      style={{ paddingBottom: insets.bottom }}
    >
      <View className="flex-row items-stretch justify-around w-full max-w-[520px] py-2">
        <ActionButton
          label={props.isStarred ? "Starred" : "Star"}
          a11yLabel={props.isStarred ? "unstar" : "star"}
          icon="star"
          tint={props.isStarred ? tokens.accent : tokens.fg}
          accentText={props.isStarred}
          onPress={() => star.mutate({ id: props.articleId, starred: !props.isStarred })}
        />
        <ActionButton
          label={props.isArchived ? "Unarchive" : "Archive"}
          a11yLabel={props.isArchived ? "unarchive" : "archive"}
          icon="archive"
          tint={props.isArchived ? tokens.accent : tokens.fg}
          accentText={props.isArchived}
          onPress={onArchiveToggle}
        />
        <ActionButton
          label="Share"
          a11yLabel="share"
          icon="share"
          tint={tokens.fg}
          onPress={onShare}
        />
        <ActionButton
          label="More"
          a11yLabel="more actions"
          icon="more-horizontal"
          tint={tokens.fg}
          onPress={showOverflow}
        />
      </View>
      {del.isPending ? (
        <View className="absolute right-4 bottom-4">
          <ActivityIndicator size="small" />
        </View>
      ) : null}
    </View>
  );
}

function ActionButton({
  label,
  a11yLabel,
  icon,
  tint,
  accentText,
  onPress,
}: {
  label: string;
  a11yLabel: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  tint: string;
  accentText?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      onPress={onPress}
      className="flex-1 items-center justify-center px-2 py-2 rounded-md hover:bg-surface-2 active:bg-surface-2"
    >
      <Feather name={icon} size={20} color={tint} />
      <Text
        className={accentText ? "text-accent text-[11px] mt-1.5" : "text-muted text-[11px] mt-1.5"}
        style={{ letterSpacing: 0.2 }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
