import { ScrollView, Text, View, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { EmptyState } from "./EmptyState";
import { ListSkeleton } from "./ListSkeleton";
import { formatRelative } from "@/lib/time";
import type { AnnotationWithArticle } from "@/db/repos/annotations";

export type AnnotationFeedProps = {
  annotations: readonly AnnotationWithArticle[];
  loading: boolean;
  emptyTitle: string;
  emptyDescription?: string;
  /** When true, only the body note is rendered as the primary text and the
   * quoted source becomes a smaller blockquote underneath. Used by the
   * Notes view, where the user's own words lead. */
  notesLead?: boolean;
};

export function AnnotationFeed({
  annotations,
  loading,
  emptyTitle,
  emptyDescription,
  notesLead = false,
}: AnnotationFeedProps) {
  const router = useRouter();
  if (loading) return <ListSkeleton rows={4} />;
  if (annotations.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        {...(emptyDescription ? { description: emptyDescription } : {})}
      />
    );
  }
  return (
    <ScrollView contentContainerClassName="px-6 py-4">
      {annotations.map((a) => {
        const note = a.text?.trim() ?? "";
        const stamp = formatRelative(a.updated_at ?? a.created_at);
        return (
          <Pressable
            key={a.id}
            accessibilityRole="link"
            onPress={() => router.push(`/(app)/article/${a.article_id}`)}
            className="border-b border-border py-5 hover:bg-surface-2 active:bg-surface-2"
          >
            {notesLead && note ? (
              <>
                <Text className="text-fg text-base leading-relaxed mb-3">{note}</Text>
                <Quote text={a.quote} />
              </>
            ) : (
              <>
                <Quote text={a.quote} large />
                {note ? (
                  <Text className="text-muted text-sm leading-relaxed mt-3">{note}</Text>
                ) : null}
              </>
            )}
            <View className="flex-row items-center justify-between mt-3">
              <Text className="text-accent text-xs flex-1 mr-3" numberOfLines={1}>
                {a.article_title ?? a.article_url}
              </Text>
              {stamp ? <Text className="text-subtle text-xs">{stamp}</Text> : null}
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function Quote({ text, large }: { text: string; large?: boolean }) {
  return (
    <View className="border-l-2 border-accent pl-3">
      <Text
        className={
          large
            ? "text-fg text-base leading-relaxed italic"
            : "text-muted text-sm leading-relaxed italic"
        }
      >
        {text}
      </Text>
    </View>
  );
}
