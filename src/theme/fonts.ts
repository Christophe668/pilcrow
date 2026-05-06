import { useFonts } from "expo-font";

export function useAppFonts() {
  const [loaded, error] = useFonts({
    Newsreader: require("../../assets/fonts/Newsreader.ttf"),
    "Newsreader-Italic": require("../../assets/fonts/Newsreader-Italic.ttf"),
  });
  return { loaded, error };
}
