import "../global.css";
import { useEffect, useState } from "react";
import { Slot, useRouter, useSegments } from "expo-router";
import { useColorScheme, View } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/theme/provider";
import { useAppFonts } from "@/theme/fonts";
import { hydrateAuth } from "@/auth/state";
import { useAuth } from "@/hooks/useAuth";
import { useBootstrapSync } from "@/hooks/useBootstrapSync";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function AuthGate() {
  const auth = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const inAuthGroup = segments[0] === "(auth)";
  const mismatch =
    auth.status === "authenticated"
      ? inAuthGroup
      : auth.status === "unauthenticated"
        ? !inAuthGroup
        : false;

  useEffect(() => {
    if (auth.status === "unknown") return;
    if (auth.status === "authenticated" && inAuthGroup) {
      router.replace("/(app)/(library)");
    } else if (auth.status === "unauthenticated" && !inAuthGroup) {
      router.replace("/(auth)/server");
    }
  }, [auth.status, inAuthGroup, router]);

  useBootstrapSync();

  if (auth.status === "unknown" || mismatch) {
    return <View className="flex-1 bg-bg" />;
  }
  return <Slot />;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const systemScheme = colorScheme === "dark" ? "dark" : "light";
  const { loaded, error } = useAppFonts();
  const [hydrated, setHydrated] = useState(false);
  const [fontTimeout, setFontTimeout] = useState(false);

  useEffect(() => {
    let cancelled = false;
    hydrateAuth()
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    // Belt-and-suspenders: even if `hydrateAuth` itself never settles,
    // unblock the gate after 4 seconds so the app never sits on a blank
    // splash forever.
    const safety = setTimeout(() => {
      if (!cancelled) setHydrated(true);
    }, 4000);
    return () => {
      cancelled = true;
      clearTimeout(safety);
    };
  }, []);

  // expo-font occasionally never resolves on Android when the variable
  // font file is huge or the network blip stalls — fall through after 4s
  // so the rest of the app still mounts.
  useEffect(() => {
    if (loaded || error) return;
    const t = setTimeout(() => setFontTimeout(true), 4000);
    return () => clearTimeout(t);
  }, [loaded, error]);

  const fontsReady = loaded || error !== null || fontTimeout;
  if (!fontsReady || !hydrated) return null;
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider initialMode="auto" systemScheme={systemScheme}>
        <AuthGate />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
