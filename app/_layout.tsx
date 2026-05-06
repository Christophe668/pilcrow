import "../global.css";
import { useEffect, useState } from "react";
import { Slot, useRouter, useSegments } from "expo-router";
import { useColorScheme, View } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/theme/provider";
import { useAppFonts } from "@/theme/fonts";
import { hydrateAuth } from "@/auth/state";
import { useAuth } from "@/hooks/useAuth";

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
      router.replace("/(app)");
    } else if (auth.status === "unauthenticated" && !inAuthGroup) {
      router.replace("/(auth)/server");
    }
  }, [auth.status, inAuthGroup, router]);

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
  useEffect(() => {
    hydrateAuth().then(() => setHydrated(true));
  }, []);
  if ((!loaded && !error) || !hydrated) return null;
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider initialMode="auto" systemScheme={systemScheme}>
        <AuthGate />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
