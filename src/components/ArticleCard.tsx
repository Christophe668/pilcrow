import { Pressable, Text, View } from "react-native";
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
};

function relativeAge(iso: string | null): string {
  if (!iso) return "";
  const dt = new Date(iso).getTime();
  if (Number.isNaN(dt)) return "";
  const days = Math.floor((Date.now() - dt) / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

export function ArticleCard(props: ArticleCardProps) {
  const meta = [
    props.domain,
    props.readingTime ? `${props.readingTime} min` : null,
    relativeAge(props.updatedAt),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Link href={`/(app)/article/${props.id}` as Href} asChild>
      <Pressable
        accessibilityRole="button"
        className="border-b border-border px-6 py-4 active:bg-surface-2"
      >
        <View className="flex-row gap-4">
          <View className="flex-1">
            <Text numberOfLines={2} className="font-display text-fg text-lg leading-tight mb-1">
              {props.title ?? props.url}
            </Text>
            <Text className="text-subtle text-xs mb-2">{meta}</Text>
            {props.tags.length > 0 ? (
              <View className="flex-row flex-wrap">
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
