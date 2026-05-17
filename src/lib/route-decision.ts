export type AuthStatus = "authenticated" | "unauthenticated" | "unknown";

export type RouteDecision =
  | { kind: "render" }
  | { kind: "redirect"; to: string }
  | { kind: "wait" };

const LIBRARY = "/(app)/(library)";
const WIZARD = "/(auth)/server";

export function decideRoute(status: AuthStatus, segments: readonly string[]): RouteDecision {
  if (status === "unknown") return { kind: "wait" };

  const inAuthGroup = segments[0] === "(auth)";
  const inAppGroup = segments[0] === "(app)";

  if (status === "authenticated") {
    if (inAppGroup) return { kind: "render" };
    return { kind: "redirect", to: LIBRARY };
  }

  // unauthenticated
  if (inAuthGroup) return { kind: "render" };
  return { kind: "redirect", to: WIZARD };
}
