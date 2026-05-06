import { Link } from "expo-router";
import { Text, View } from "react-native";
import { useAuth } from "@/hooks/useAuth";

export default function AppHome() {
  const auth = useAuth();
  const host = auth.status === "authenticated" ? new URL(auth.serverUrl).host : "";
  return (
    <View className="flex-1 bg-bg px-6 pt-16">
      <Text className="font-display text-fg text-4xl mb-2">wallabag</Text>
      <Text className="text-muted text-base mb-6">Signed in to {host}</Text>
      <Text className="text-fg text-sm mb-2">
        Library is coming in Phase 3. For now you can sign out from Settings.
      </Text>
      <Link href="/(app)/settings" className="text-accent mt-4">
        Settings →
      </Link>
    </View>
  );
}
