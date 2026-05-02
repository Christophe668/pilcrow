import { View } from "react-native";
import { LibraryHeader } from "@/components/LibraryHeader";
import { AnnotationFeed } from "@/components/AnnotationFeed";
import { useAllAnnotations } from "@/hooks/useAllAnnotations";

export default function NotesRoute() {
  const annotations = useAllAnnotations({ withNoteOnly: true });
  return (
    <View className="flex-1">
      <LibraryHeader
        title="Notes"
        {...(annotations.data ? { count: annotations.data.length } : {})}
      />
      <AnnotationFeed
        annotations={annotations.data ?? []}
        loading={annotations.isLoading}
        emptyTitle="No notes yet"
        emptyDescription="Tap a highlight in an article to attach a note. Notes you write show up here."
        notesLead
      />
    </View>
  );
}
