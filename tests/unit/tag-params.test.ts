import { describe, it, expect } from "vitest";
import { parseTagsParam, serializeTagsParam, toggleTag } from "@/lib/tagParams";

describe("parseTagsParam", () => {
  it("returns an empty array for missing or empty input", () => {
    expect(parseTagsParam(undefined)).toEqual([]);
    expect(parseTagsParam("")).toEqual([]);
    expect(parseTagsParam(",,,")).toEqual([]);
  });

  it("splits comma-separated slugs", () => {
    expect(parseTagsParam("design,rust")).toEqual(["design", "rust"]);
  });

  it("trims whitespace and drops empty entries", () => {
    expect(parseTagsParam(" design , , rust ")).toEqual(["design", "rust"]);
  });

  it("flattens an array form (when expo-router provides string[])", () => {
    expect(parseTagsParam(["design", "rust,typography"])).toEqual(["design", "rust", "typography"]);
  });
});

describe("serializeTagsParam", () => {
  it("returns undefined for an empty list (so URL strips ?tags=)", () => {
    expect(serializeTagsParam([])).toBeUndefined();
  });
  it("joins slugs with comma", () => {
    expect(serializeTagsParam(["design", "rust"])).toBe("design,rust");
  });
});

describe("toggleTag", () => {
  it("adds a slug not currently present", () => {
    expect(toggleTag(["design"], "rust")).toEqual(["design", "rust"]);
  });
  it("removes a slug already present", () => {
    expect(toggleTag(["design", "rust"], "design")).toEqual(["rust"]);
  });
  it("does not mutate the input", () => {
    const before = ["design"];
    toggleTag(before, "rust");
    expect(before).toEqual(["design"]);
  });
});
