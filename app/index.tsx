import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";

type Feature = {
  title: string;
  body: string;
};

const FEATURES: readonly Feature[] = [
  {
    title: "Bring your own server",
    body: "Connect to a self-hosted Wallabag or Readeck instance. Your articles, your storage.",
  },
  {
    title: "Built for reading",
    body: "Newsreader serif, paper background, and per-article font and theme controls — light, dark, or sepia.",
  },
  {
    title: "Offline-first",
    body: "Articles, tags, and highlights sync to local SQLite, so the queue is there even on the train.",
  },
  {
    title: "Highlights and notes",
    body: "Select text to highlight, attach a note, and pick up where you left off across devices.",
  },
];

export default function LandingScreen() {
  const router = useRouter();

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="items-center px-6 py-16">
      <View className="w-full max-w-[720px]">
        <Text className="font-display text-fg text-6xl mb-3">Pilcrow</Text>
        <Text className="text-muted text-xl mb-10 leading-7">
          A calm reading client for self-hosted Wallabag and Readeck. iOS, Android, and web — one
          queue, one library.
        </Text>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/(auth)/server")}
          className="bg-accent rounded-md py-3 px-6 items-center self-start mb-12"
        >
          <Text className="text-white font-medium">Sign in</Text>
        </Pressable>

        <View className="gap-y-6">
          {FEATURES.map((f) => (
            <View key={f.title} className="border-l-2 border-border pl-4">
              <Text className="text-fg text-lg mb-1">{f.title}</Text>
              <Text className="text-muted text-base leading-6">{f.body}</Text>
            </View>
          ))}
        </View>

        <View className="border-t border-border mt-16 pt-6">
          <Text className="text-subtle text-xs">
            An independent client. Wallabag and Readeck are trademarks of their respective owners.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}
