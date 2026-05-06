import { Image, Pressable, Text, View } from "react-native";
import { Link, type Href } from "expo-router";
import { TagChip } from "./TagChip";
import { useToggleStarred } from "@/hooks/useToggleStarred";
import { useToggleArchived } from "@/hooks/useToggleArchived";

export type ArticleCardProps = {
  id: number;
  title: string | null;
  url: string;
  domain: string | null;
  readingTime: number | null;
  isStarred: boolean;
  isArchived: boolean;
  updatedAt: string | null;
  previewImage: string | null;
  tags: { id: number; label: string; slug: string }[];
  excerpt?: string | null;
};

function htmlToExcerpt(html: string | null | undefined): string | null {
  if (!html) return null;
  // Strip tags and collapse whitespace.
  const stripped = html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
  if (stripped.length === 0) return null;
  if (stripped.length <= 180) return stripped;
  return stripped.slice(0, 180).trimEnd() + "…";
}

function glyphFor(title: string | null, domain: string | null, url: string): string {
  const source = (title ?? domain ?? url ?? "").trim();
  const ch = source.charAt(0);
  if (!ch) return "•";
  return ch.toUpperCase();
}

export function ArticleCard(props: ArticleCardProps) {
  const star = useToggleStarred();
  const archive = useToggleArchived();
  const meta = [props.domain, props.readingTime ? `${props.readingTime} min` : null]
    .filter(Boolean)
    .join(" · ");
  const excerpt = htmlToExcerpt(props.excerpt);
  const showUnreadBar = !props.isArchived;
  return (
    <View className="flex-row items-stretch border-b border-border px-6 py-5 relative">
      {showUnreadBar ? (
        <View
          className="absolute left-0 top-0 bottom-0 w-[2px] bg-accent"
          accessibilityLabel="unread"
        />
      ) : null}
      <Link href={`/(app)/article/${props.id}` as Href} asChild>
        <Pressable
          accessibilityRole="button"
          className="flex-1 flex-row gap-4 items-start active:bg-surface-2 -mx-2 px-2 -my-1 py-1 rounded-md"
        >
          <View className="w-16 h-16 rounded-md border border-border bg-accent-soft items-center justify-center overflow-hidden">
            {props.previewImage ? (
              <Image
                source={{ uri: props.previewImage }}
                style={{ width: "100%", height: "100%" }}
                resizeMode="cover"
                accessibilityIgnoresInvertColors
              />
            ) : (
              <Text className="font-display text-accent-ink text-2xl font-medium">
                {glyphFor(props.title, props.domain, props.url)}
              </Text>
            )}
          </View>
          <View className="flex-1 min-w-0">
            {meta.length > 0 ? <Text className="text-subtle text-xs mb-1">{meta}</Text> : null}
            <Text
              numberOfLines={2}
              className="font-display text-fg text-[19px] leading-tight font-medium tracking-tight mb-1.5"
            >
              {props.title ?? props.url}
            </Text>
            {excerpt ? (
              <Text numberOfLines={2} className="text-muted text-sm leading-snug mb-2">
                {excerpt}
              </Text>
            ) : null}
            {props.tags.length > 0 ? (
              <View className="flex-row flex-wrap mt-1">
                {props.tags.slice(0, 4).map((t) => (
                  <TagChip key={t.id} label={t.label} />
                ))}
              </View>
            ) : null}
          </View>
        </Pressable>
      </Link>
      <View className="flex-col items-center justify-start ml-3 gap-1">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={props.isStarred ? "unstar" : "star"}
          onPress={() => star.mutate({ id: props.id, starred: !props.isStarred })}
          className="w-9 h-9 items-center justify-center rounded-md active:bg-surface-2"
        >
          <Text className={props.isStarred ? "text-accent text-base" : "text-subtle text-base"}>
            {props.isStarred ? "★" : "☆"}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={props.isArchived ? "unarchive" : "archive"}
          onPress={() => archive.mutate({ id: props.id, archived: !props.isArchived })}
          className="w-9 h-9 items-center justify-center rounded-md active:bg-surface-2"
        >
          <Text className={props.isArchived ? "text-accent text-xs" : "text-subtle text-xs"}>
            {props.isArchived ? "↩" : "▥"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
