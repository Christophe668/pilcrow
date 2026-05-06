import "../global.css";
import { Stack } from "expo-router";
import { useColorScheme } from "react-native";
import { ThemeProvider } from "@/theme/provider";
import { useAppFonts } from "@/theme/fonts";

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const systemScheme: "light" | "dark" = colorScheme === "dark" ? "dark" : "light";
  const { loaded, error } = useAppFonts();
  if (!loaded && !error) return null;
  return (
    <ThemeProvider initialMode="auto" systemScheme={systemScheme}>
      <Stack screenOptions={{ headerShown: false }} />
    </ThemeProvider>
  );
}
