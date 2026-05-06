import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/hooks/useAuth";
import { signOut } from "@/auth/state";

export default function Settings() {
  const auth = useAuth();
  const router = useRouter();
  const onSignOut = async () => {
    await signOut();
    router.replace("/(auth)/server");
  };
  const host = auth.status === "authenticated" ? new URL(auth.serverUrl).host : "—";
  return (
    <View className="flex-1 bg-bg px-6 pt-16">
      <Text className="font-display text-fg text-3xl mb-6">Settings</Text>

      <Section title="Account">
        <Row label="Server" value={host} />
      </Section>

      <Pressable
        accessibilityRole="button"
        onPress={onSignOut}
        className="border border-border bg-surface rounded-md py-3 items-center mt-8"
      >
        <Text className="text-accent">Sign out</Text>
      </Pressable>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mb-6">
      <Text className="font-mono text-subtle uppercase text-xs tracking-widest mb-2">{title}</Text>
      <View className="border border-border bg-surface rounded-md">{children}</View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between px-4 py-3 border-b border-border last:border-0">
      <Text className="text-muted text-sm">{label}</Text>
      <Text className="text-fg text-sm">{value}</Text>
    </View>
  );
}
