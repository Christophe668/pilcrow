import { Pressable, Text, View } from "react-native";

export type SelectionToolbarProps = {
  visible: boolean;
  onHighlight: () => void;
  onDismiss: () => void;
};

export function SelectionToolbar(props: SelectionToolbarProps) {
  if (!props.visible) return null;
  return (
    <View pointerEvents="box-none" className="absolute left-0 right-0 bottom-16 items-center">
      <View className="flex-row items-center gap-2 bg-fg rounded-full px-2 py-1.5 shadow-lg">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="highlight selection"
          onPress={props.onHighlight}
          className="px-4 py-1.5"
        >
          <Text className="text-bg text-sm font-medium">Highlight</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="dismiss selection toolbar"
          onPress={props.onDismiss}
          className="px-3 py-1.5"
        >
          <Text className="text-bg text-sm">✕</Text>
        </Pressable>
      </View>
    </View>
  );
}
