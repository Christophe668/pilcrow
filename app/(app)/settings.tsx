import { useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, Text, View } from "react-native";
import { Link, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useAuth } from "@/hooks/useAuth";
import { signOut } from "@/auth/state";
import { useSyncStatus } from "@/hooks/useSyncStatus";
import { useSyncNow } from "@/hooks/useSyncNow";
import { BookmarkletCard } from "@/components/BookmarkletCard";
import { getBackend } from "@/api/backend";
import { useTokens } from "@/theme/provider";

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
  const insets = useSafeAreaInsets();
  const tokens = useTokens();
  const status = useSyncStatus();
  const sync = useSyncNow();
  const [signingOut, setSigningOut] = useState(false);

  const onBack = () => {
    // Prefer the natural back-stack pop so we land on whichever
    // library route the user came from; if there's no history (deep
    // link, fresh tab) fall back to the unread bucket.
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(app)/(library)");
    }
  };

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
  const backendKind = getBackend().kind;
  const backendLabel = backendKind === "readeck" ? "Readeck" : "Wallabag";

  const onChangeServer = () => {
    const title = "Switch to a different server?";
    const body = "You'll be signed out of this device and asked to sign in again.";
    const go = async () => {
      await signOut();
      router.replace("/(auth)/server");
    };
    if (Platform.OS === "web") {
      // eslint-disable-next-line no-alert
      if (typeof window !== "undefined" && window.confirm(`${title}\n\n${body}`)) {
        void go();
      }
      return;
    }
    Alert.alert(title, body, [
      { text: "Cancel", style: "cancel" },
      { text: "Continue", style: "destructive", onPress: () => void go() },
    ]);
  };

  return (
    <View className="flex-1 bg-bg items-center px-6" style={{ paddingTop: insets.top + 24 }}>
      <View className="w-full max-w-[680px]">
        <View className="flex-row items-center mb-6 -ml-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={onBack}
            className="p-2 rounded-md hover:bg-surface-2 active:bg-surface-2"
          >
            <Feather name="chevron-left" size={22} color={tokens.fg} />
          </Pressable>
          <Text className="font-display text-fg text-3xl ml-1">Settings</Text>
        </View>

        <Section title="Account">
          <Row label="Type" value={backendLabel} />
          <Pressable
            accessibilityRole="button"
            onPress={onChangeServer}
            className="flex-row items-center justify-between px-4 py-3"
          >
            <Text className="text-muted text-sm">Server</Text>
            <View className="flex-row items-center">
              <Text className="text-fg text-sm mr-2">{host}</Text>
              <Text className="text-subtle text-sm">›</Text>
            </View>
          </Pressable>
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

        <Section title="Library">
          <Link href="/(app)/(library)/stats" asChild>
            <Pressable
              accessibilityRole="link"
              className="px-4 py-3 flex-row justify-between items-center"
            >
              <Text className="text-fg text-sm">Stats</Text>
              <Text className="text-subtle text-sm">›</Text>
            </Pressable>
          </Link>
        </Section>

        <Section title="Save shortcuts">
          <View className="px-1 py-1">
            <BookmarkletCard />
          </View>
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
