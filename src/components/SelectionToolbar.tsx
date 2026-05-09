import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export type SelectionToolbarProps = {
  visible: boolean;
  onHighlight: () => void;
  /** Highlight + immediately open the annotation sheet so the user can write
   * a note in the same gesture. Most highlights stand alone; the ones that
   * don't are usually the ones worth annotating in detail. */
  onAnnotate: () => void;
  onDismiss: () => void;
};

export function SelectionToolbar(props: SelectionToolbarProps) {
  const insets = useSafeAreaInsets();
  if (!props.visible) return null;
  // Float clear of the ActionBar (≈48px tall + the bottom safe-area inset).
  // The pill uses surface-2 with a soft border instead of full inversion —
  // the reader background is a warm cream, and bg-fg slammed against it
  // reads as a hard block. The strong border keeps it discoverable without
  // shouting.
  return (
    <View
      pointerEvents="box-none"
      className="absolute left-0 right-0 items-center px-4"
      style={{ bottom: insets.bottom + 64 }}
    >
      <View
        className="flex-row items-center bg-surface-2 rounded-full shadow-lg border border-border-strong"
        style={{ paddingHorizontal: 4, paddingVertical: 4 }}
      >
        <ToolbarButton label="Highlight" onPress={props.onHighlight} />
        <View className="w-px h-5 bg-border" />
        <ToolbarButton label="Annotate" onPress={props.onAnnotate} />
        <View className="w-px h-5 bg-border" />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="dismiss selection toolbar"
          onPress={props.onDismiss}
          hitSlop={8}
          className="px-3 py-1.5"
        >
          <Text className="text-muted text-sm">✕</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ToolbarButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label.toLowerCase()}
      onPress={onPress}
      className="px-4 py-1.5"
    >
      <Text className="text-fg text-sm font-medium">{label}</Text>
    </Pressable>
  );
}
