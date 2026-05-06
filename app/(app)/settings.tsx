import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/hooks/useAuth";
import { signOut } from "@/auth/state";
import { useSyncStatus } from "@/hooks/useSyncStatus";
import { useSyncNow } from "@/hooks/useSyncNow";

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "never";
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function Settings() {
  const auth = useAuth();
  const router = useRouter();
  const status = useSyncStatus();
  const sync = useSyncNow();
  const [signingOut, setSigningOut] = useState(false);

  const onSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      router.replace("/(auth)/server");
    } finally {
      setSigningOut(false);
    }
  };

  const host = auth.status === "authenticated" ? new URL(auth.serverUrl).host : "—";

  return (
    <View className="flex-1 bg-bg px-6 pt-16">
      <Text className="font-display text-fg text-3xl mb-6">Settings</Text>

      <Section title="Account">
        <Row label="Server" value={host} />
      </Section>

      <Section title="Sync">
        <Row label="Last sync" value={relativeTime(status.data?.lastFullSyncAt ?? null)} />
        <Pressable
          accessibilityRole="button"
          disabled={sync.isPending}
          onPress={() => sync.mutate()}
          className="px-4 py-3 border-t border-border"
        >
          {sync.isPending ? (
            <ActivityIndicator />
          ) : (
            <Text className="text-accent text-sm">Sync now</Text>
          )}
        </Pressable>
      </Section>

      <Pressable
        accessibilityRole="button"
        disabled={signingOut}
        onPress={onSignOut}
        className="border border-border bg-surface rounded-md py-3 items-center mt-8"
      >
        {signingOut ? <ActivityIndicator /> : <Text className="text-accent">Sign out</Text>}
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
