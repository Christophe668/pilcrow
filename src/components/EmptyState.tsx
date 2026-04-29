import { Pressable, Text, View } from "react-native";
import { Link, type Href } from "expo-router";

export type EmptyStateAction = {
  label: string;
  href: Href;
};

export type EmptyStateProps = {
  title: string;
  description?: string;
  glyph?: string;
  /** Primary CTA. Most empty states have one obvious next step ("Save an
   * article" from an empty Unread); surface it as a button so the user
   * doesn't have to remember where the affordance lives. */
  action?: EmptyStateAction;
};

export function EmptyState({ title, description, glyph = "✦", action }: EmptyStateProps) {
  return (
    <View className="flex-1 items-center justify-center px-12 py-24">
      <View className="w-20 h-20 rounded-full bg-accent-soft items-center justify-center mb-6">
        <Text className="text-3xl text-accent-ink">{glyph}</Text>
      </View>
      <Text className="font-display text-fg text-2xl text-center mb-2">{title}</Text>
      {description ? (
        <Text className="text-muted text-sm text-center max-w-sm leading-relaxed mb-6">
          {description}
        </Text>
      ) : null}
      {action ? (
        <Link href={action.href} asChild>
          <Pressable className="bg-fg rounded-md px-5 py-3">
            <Text className="text-bg font-medium">{action.label}</Text>
          </Pressable>
        </Link>
      ) : null}
    </View>
  );
}
