import { describe, it, expect } from "vitest";
import { decideRoute } from "@/lib/route-decision";

describe("decideRoute", () => {
  it("signed-out at root → redirect to wizard", () => {
    expect(decideRoute("unauthenticated", [])).toEqual({
      kind: "redirect",
      to: "/(auth)/server",
    });
  });

  it("signed-out in (auth) → render", () => {
    expect(decideRoute("unauthenticated", ["(auth)", "server"])).toEqual({
      kind: "render",
    });
  });

  it("signed-out elsewhere → redirect to wizard", () => {
    expect(decideRoute("unauthenticated", ["(app)", "(library)"])).toEqual({
      kind: "redirect",
      to: "/(auth)/server",
    });
  });

  it("signed-in at root → redirect to library", () => {
    expect(decideRoute("authenticated", [])).toEqual({
      kind: "redirect",
      to: "/(app)/(library)",
    });
  });

  it("signed-in in (app) → render", () => {
    expect(decideRoute("authenticated", ["(app)", "(library)"])).toEqual({
      kind: "render",
    });
  });

  it("signed-in in (auth) → redirect to library", () => {
    expect(decideRoute("authenticated", ["(auth)", "server"])).toEqual({
      kind: "redirect",
      to: "/(app)/(library)",
    });
  });

  it("auth status unknown → no decision", () => {
    expect(decideRoute("unknown", [])).toEqual({ kind: "wait" });
    expect(decideRoute("unknown", ["(app)"])).toEqual({ kind: "wait" });
  });
});
