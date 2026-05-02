import { useState, useEffect } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { useUpdateAnnotation } from "@/hooks/useUpdateAnnotation";
import { useDeleteAnnotation } from "@/hooks/useDeleteAnnotation";

export type AnnotationSheetProps = {
  annotation: {
    id: number;
    quote: string;
    text: string | null;
  } | null;
  onClose: () => void;
};

export function AnnotationSheet({ annotation, onClose }: AnnotationSheetProps) {
  const [text, setText] = useState("");
  const update = useUpdateAnnotation();
  const del = useDeleteAnnotation();

  useEffect(() => {
    setText(annotation?.text ?? "");
  }, [annotation?.id, annotation?.text]);

  if (!annotation) return null;

  const onDone = async () => {
    if (text !== (annotation.text ?? "")) {
      await update.mutateAsync({
        id: annotation.id,
        text: text.trim().length === 0 ? null : text,
      });
    }
    onClose();
  };

  const onDelete = async () => {
    await del.mutateAsync(annotation.id);
    onClose();
  };

  return (
    <View className="absolute left-0 right-0 bottom-0 px-6 py-6 border-t border-border bg-surface">
      <View className="flex-row items-center justify-between mb-3">
        <Text className="font-display text-fg text-xl">Highlight</Text>
        <Pressable accessibilityRole="button" onPress={onClose} className="px-2 py-1">
          <Text className="text-accent text-sm">Close</Text>
        </Pressable>
      </View>
      <View className="border-l-2 border-accent pl-3 mb-4">
        <Text className="text-muted text-sm" numberOfLines={3}>
          {annotation.quote}
        </Text>
      </View>
      <Text className="text-fg text-sm mb-2">Note (optional)</Text>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Add a note about this highlight…"
        placeholderTextColor="#888"
        multiline
        numberOfLines={3}
        className="border border-border bg-bg text-fg rounded-md px-3 py-2 mb-4"
      />
      <View className="flex-row gap-3">
        <Pressable
          accessibilityRole="button"
          onPress={onDelete}
          disabled={del.isPending}
          className="flex-1 border border-border rounded-md py-3 items-center"
        >
          {del.isPending ? <ActivityIndicator /> : <Text className="text-accent">Delete</Text>}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onDone}
          disabled={update.isPending}
          className="flex-1 bg-accent rounded-md py-3 items-center"
        >
          {update.isPending ? (
            <ActivityIndicator />
          ) : (
            <Text className="text-white font-medium">Done</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}
