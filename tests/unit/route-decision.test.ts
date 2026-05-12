import { describe, it, expect } from "vitest";
import { decideRoute } from "@/lib/route-decision";

describe("decideRoute", () => {
  it("web signed-out at root → render", () => {
    expect(decideRoute("web", "unauthenticated", [])).toEqual({ kind: "render" });
  });

  it("web signed-out in (auth) → render", () => {
    expect(decideRoute("web", "unauthenticated", ["(auth)", "server"])).toEqual({
      kind: "render",
    });
  });

  it("web signed-out elsewhere → redirect to wizard", () => {
    expect(decideRoute("web", "unauthenticated", ["(app)", "(library)"])).toEqual({
      kind: "redirect",
      to: "/(auth)/server",
    });
  });

  it("web signed-in at root → redirect to library", () => {
    expect(decideRoute("web", "authenticated", [])).toEqual({
      kind: "redirect",
      to: "/(app)/(library)",
    });
  });

  it("web signed-in in (app) → render", () => {
    expect(decideRoute("web", "authenticated", ["(app)", "(library)"])).toEqual({
      kind: "render",
    });
  });

  it("web signed-in in (auth) → redirect to library", () => {
    expect(decideRoute("web", "authenticated", ["(auth)", "server"])).toEqual({
      kind: "redirect",
      to: "/(app)/(library)",
    });
  });

  it("native signed-out at root → redirect to wizard", () => {
    expect(decideRoute("ios", "unauthenticated", [])).toEqual({
      kind: "redirect",
      to: "/(auth)/server",
    });
    expect(decideRoute("android", "unauthenticated", [])).toEqual({
      kind: "redirect",
      to: "/(auth)/server",
    });
  });

  it("native signed-in at root → redirect to library", () => {
    expect(decideRoute("ios", "authenticated", [])).toEqual({
      kind: "redirect",
      to: "/(app)/(library)",
    });
  });

  it("auth status unknown → no decision", () => {
    expect(decideRoute("web", "unknown", [])).toEqual({ kind: "wait" });
    expect(decideRoute("ios", "unknown", ["(app)"])).toEqual({ kind: "wait" });
  });
});
