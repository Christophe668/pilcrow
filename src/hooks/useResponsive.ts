import { useWindowDimensions } from "react-native";

export type Breakpoint = "phone" | "tablet" | "desktop";

export function useBreakpoint(): Breakpoint {
  const { width } = useWindowDimensions();
  if (width >= 1280) return "desktop";
  if (width >= 768) return "tablet";
  return "phone";
}
