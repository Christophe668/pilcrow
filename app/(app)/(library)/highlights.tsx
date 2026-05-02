import { View } from "react-native";
import { LibraryHeader } from "@/components/LibraryHeader";
import { AnnotationFeed } from "@/components/AnnotationFeed";
import { useAllAnnotations } from "@/hooks/useAllAnnotations";

export default function HighlightsRoute() {
  const annotations = useAllAnnotations();
  return (
    <View className="flex-1">
      <LibraryHeader
        title="Highlights"
        {...(annotations.data ? { count: annotations.data.length } : {})}
      />
      <AnnotationFeed
        annotations={annotations.data ?? []}
        loading={annotations.isLoading}
        emptyTitle="No highlights yet"
        emptyDescription="Long-press text in an article and tap Highlight to save passages here."
      />
    </View>
  );
}
