import { Slot } from "expo-router";
import { View } from "react-native";

export default function LibraryLayout() {
  return (
    <View className="flex-1 bg-bg">
      <Slot />
    </View>
  );
}
