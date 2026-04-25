import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  beginReadeckSignIn,
  pollReadeckSignIn,
  type DeviceCodeChallenge,
} from "@/api/backend/auth";
import { completeReadeckSignIn } from "@/auth/state";

type Phase =
  | { kind: "starting" }
  | { kind: "awaiting"; challenge: DeviceCodeChallenge; pollDelayMs: number }
  | { kind: "expired" }
  | { kind: "complete" }
  | { kind: "error"; message: string };

const MIN_INTERVAL_MS = 1_000;

export default function ReadeckAuthScreen() {
  const router = useRouter();
  const { serverUrl } = useLocalSearchParams<{ serverUrl: string }>();
  const [phase, setPhase] = useState<Phase>({ kind: "starting" });
  // The polling loop reads from a ref so we can cancel it without
  // tearing down the effect that started it.
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!serverUrl) {
      setPhase({ kind: "error", message: "Missing server URL — restart onboarding" });
      return;
    }
    cancelledRef.current = false;
    void start(serverUrl);
    return () => {
      cancelledRef.current = true;
    };

    async function start(url: string) {
      try {
        const challenge = await beginReadeckSignIn({ kind: "readeck", serverUrl: url });
        if (cancelledRef.current) return;
        setPhase({
          kind: "awaiting",
          challenge,
          pollDelayMs: Math.max(challenge.intervalSeconds * 1000, MIN_INTERVAL_MS),
        });
        void poll(challenge, Math.max(challenge.intervalSeconds * 1000, MIN_INTERVAL_MS));
      } catch (e) {
        if (cancelledRef.current) return;
        setPhase({
          kind: "error",
          message: e instanceof Error ? e.message : "Could not start Readeck sign-in",
        });
      }
    }

    async function poll(challenge: DeviceCodeChallenge, delayMs: number) {
      while (!cancelledRef.current) {
        if (Date.now() > challenge.expiresAt) {
          setPhase({ kind: "expired" });
          return;
        }
        await new Promise((r) => setTimeout(r, delayMs));
        if (cancelledRef.current) return;
        try {
          const r = await pollReadeckSignIn(challenge);
          if (cancelledRef.current) return;
          if (r.status === "complete") {
            completeReadeckSignIn(challenge.serverUrl);
            setPhase({ kind: "complete" });
            // Replace so the back button doesn't return to onboarding.
            router.replace("/(app)/(library)");
            return;
          }
          if (r.status === "slow_down") {
            // RFC 8628: bump the polling cadence permanently.
            delayMs = delayMs + 5_000;
            setPhase({ kind: "awaiting", challenge, pollDelayMs: delayMs });
          }
          // pending: just loop with the same cadence.
        } catch (e) {
          if (cancelledRef.current) return;
          setPhase({
            kind: "error",
            message: e instanceof Error ? e.message : "Sign-in failed",
          });
          return;
        }
      }
    }
  }, [serverUrl, router]);

  return (
    <View className="flex-1 bg-bg items-center justify-center px-6">
      <View className="w-full max-w-[420px]">
        <Text className="font-display text-fg text-3xl mb-1">Connect Readeck</Text>
        <Text className="text-muted text-sm mb-6">{hostOf(serverUrl)}</Text>

        {phase.kind === "starting" ? (
          <View className="items-center py-10">
            <ActivityIndicator />
            <Text className="text-muted text-sm mt-3">Registering this app…</Text>
          </View>
        ) : null}

        {phase.kind === "awaiting" ? (
          <View>
            <Text className="text-fg text-sm mb-2">
              Open this URL on your computer or another device:
            </Text>
            <Pressable
              accessibilityRole="link"
              onPress={() => Linking.openURL(phase.challenge.verificationUriComplete)}
            >
              <Text className="text-accent text-base mb-6 underline">
                {phase.challenge.verificationUri}
              </Text>
            </Pressable>

            <Text className="text-fg text-sm mb-2">When asked, type or confirm this code:</Text>
            <View className="rounded-md bg-surface border border-border py-4 items-center mb-6">
              <Text
                accessibilityLabel={`Verification code ${phase.challenge.userCode}`}
                className="font-display text-fg text-3xl tracking-widest"
              >
                {phase.challenge.userCode}
              </Text>
            </View>

            <View className="flex-row items-center gap-2">
              <ActivityIndicator />
              <Text className="text-muted text-sm">
                Waiting for approval (checking every {Math.round(phase.pollDelayMs / 1000)}s)…
              </Text>
            </View>
          </View>
        ) : null}

        {phase.kind === "expired" ? (
          <View>
            <Text className="text-accent text-sm mb-4">
              The verification code has expired. Go back and try again.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.back()}
              className="bg-accent rounded-md py-3 items-center"
            >
              <Text className="text-white font-medium">Back</Text>
            </Pressable>
          </View>
        ) : null}

        {phase.kind === "error" ? (
          <View>
            <Text className="text-accent text-sm mb-4">{phase.message}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.back()}
              className="bg-accent rounded-md py-3 items-center"
            >
              <Text className="text-white font-medium">Back</Text>
            </Pressable>
          </View>
        ) : null}

        {phase.kind === "complete" ? (
          <View className="items-center py-10">
            <ActivityIndicator />
            <Text className="text-muted text-sm mt-3">Signed in. Loading library…</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function hostOf(u: string | undefined): string {
  if (!u) return "";
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
}
