import { Image, Pressable, Text, View } from "react-native";
import { Link, type Href } from "expo-router";
import { TagChip } from "./TagChip";

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
  const meta = [props.domain, props.readingTime ? `${props.readingTime} min` : null]
    .filter(Boolean)
    .join(" · ");
  const excerpt = htmlToExcerpt(props.excerpt);
  const showUnreadBar = !props.isArchived;
  return (
    <Link href={`/(app)/article/${props.id}` as Href} asChild>
      <Pressable
        accessibilityRole="button"
        className="border-b border-border px-6 py-5 active:bg-surface-2 relative"
      >
        {showUnreadBar ? (
          <View
            className="absolute left-0 top-0 bottom-0 w-[2px] bg-accent"
            accessibilityLabel="unread"
          />
        ) : null}
        <View className="flex-row gap-4 items-start">
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
          {props.isStarred ? (
            <Text className="text-accent text-sm" accessibilityLabel="starred">
              ★
            </Text>
          ) : null}
        </View>
      </Pressable>
    </Link>
  );
}
