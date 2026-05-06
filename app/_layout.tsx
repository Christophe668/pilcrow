import "../global.css";
import { Stack } from "expo-router";
import { useColorScheme } from "react-native";
import { ThemeProvider } from "@/theme/provider";

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const systemScheme: "light" | "dark" = colorScheme === "dark" ? "dark" : "light";
  return (
    <ThemeProvider initialMode="auto" systemScheme={systemScheme}>
      <Stack screenOptions={{ headerShown: false }} />
    </ThemeProvider>
  );
}
