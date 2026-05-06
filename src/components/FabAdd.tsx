import { Pressable, Text } from "react-native";
import { Link } from "expo-router";
import type { Href } from "expo-router";

const ADD_ROUTE = "/(app)/add" as Href;

export function FabAdd() {
  return (
    <Link href={ADD_ROUTE} asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="add article"
        className="absolute right-6 bottom-20 w-14 h-14 rounded-full bg-accent items-center justify-center shadow-lg"
      >
        <Text className="text-white text-3xl leading-none -mt-1">+</Text>
      </Pressable>
    </Link>
  );
}
