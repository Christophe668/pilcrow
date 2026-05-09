export type Platform = "web" | "ios" | "android";
export type AuthStatus = "authenticated" | "unauthenticated" | "unknown";

export type RouteDecision =
  | { kind: "render" }
  | { kind: "redirect"; to: string }
  | { kind: "wait" };

const LIBRARY = "/(app)/(library)";
const WIZARD = "/(auth)/server";

export function decideRoute(
  platform: Platform,
  status: AuthStatus,
  segments: readonly string[],
): RouteDecision {
  if (status === "unknown") return { kind: "wait" };

  const inAuthGroup = segments[0] === "(auth)";
  const inAppGroup = segments[0] === "(app)";
  const atRoot = segments.length === 0;
  const isWeb = platform === "web";

  if (status === "authenticated") {
    if (inAppGroup) return { kind: "render" };
    return { kind: "redirect", to: LIBRARY };
  }

  // unauthenticated
  if (inAuthGroup) return { kind: "render" };
  if (atRoot && isWeb) return { kind: "render" };
  return { kind: "redirect", to: WIZARD };
}
