import { describe, it, expect, beforeEach } from "vitest";
import { serializeRange, deserializeRange } from "@/reader/range-serializer";

let root: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = "";
  root = document.createElement("div");
  document.body.appendChild(root);
});

function setHtml(html: string) {
  root.innerHTML = html;
}

function selectText(node: Node, startOffset: number, endOffset: number): Range {
  const r = document.createRange();
  r.setStart(node, startOffset);
  r.setEnd(node, endOffset);
  return r;
}

describe("serializeRange (single-block)", () => {
  it("first paragraph, full text", () => {
    setHtml("<p>hello world</p>");
    const p = root.querySelector("p")!;
    const range = selectText(p.firstChild!, 0, 11);
    const ser = serializeRange(range, root);
    expect(ser).toEqual({ start: "/p[1]", startOffset: 0, end: "/p[1]", endOffset: 11 });
  });

  it("nth paragraph", () => {
    setHtml("<p>a</p><p>b</p><p>cdef</p>");
    const target = root.querySelectorAll("p")[2]!;
    const range = selectText(target.firstChild!, 1, 3);
    expect(serializeRange(range, root)).toEqual({
      start: "/p[3]",
      startOffset: 1,
      end: "/p[3]",
      endOffset: 3,
    });
  });

  it("nested span inside p", () => {
    setHtml('<p>before <span class="x">selected</span> after</p>');
    const span = root.querySelector("span")!;
    const range = selectText(span.firstChild!, 0, 8);
    expect(serializeRange(range, root)).toEqual({
      start: "/p[1]/span[1]",
      startOffset: 0,
      end: "/p[1]/span[1]",
      endOffset: 8,
    });
  });

  it("h2 element", () => {
    setHtml("<h2>Heading</h2><p>body</p>");
    const h2 = root.querySelector("h2")!;
    const range = selectText(h2.firstChild!, 0, 7);
    expect(serializeRange(range, root)).toEqual({
      start: "/h2[1]",
      startOffset: 0,
      end: "/h2[1]",
      endOffset: 7,
    });
  });

  it("emits distinct start/end paths for a multi-block range", () => {
    setHtml("<p>first</p><p>second</p>");
    const ps = root.querySelectorAll("p");
    const range = document.createRange();
    range.setStart(ps[0]!.firstChild!, 1);
    range.setEnd(ps[1]!.firstChild!, 3);
    expect(serializeRange(range, root)).toEqual({
      start: "/p[1]",
      startOffset: 1,
      end: "/p[2]",
      endOffset: 3,
    });
  });
});

describe("deserializeRange", () => {
  it("round-trips a simple paragraph selection", () => {
    setHtml("<p>hello world</p>");
    const back = deserializeRange(
      { start: "/p[1]", startOffset: 0, end: "/p[1]", endOffset: 11 },
      root,
    );
    expect(back).not.toBeNull();
    expect(back!.toString()).toBe("hello world");
  });

  it("round-trips a span selection", () => {
    setHtml('<p>before <span class="x">selected</span> after</p>');
    const back = deserializeRange(
      { start: "/p[1]/span[1]", startOffset: 0, end: "/p[1]/span[1]", endOffset: 8 },
      root,
    );
    expect(back).not.toBeNull();
    expect(back!.toString()).toBe("selected");
  });

  it("returns null when xpath cannot be resolved", () => {
    setHtml("<p>x</p>");
    expect(
      deserializeRange({ start: "/p[5]", startOffset: 0, end: "/p[5]", endOffset: 1 }, root),
    ).toBeNull();
  });

  it("clamps offsets that exceed the resolved node's length", () => {
    setHtml("<p>short</p>");
    const back = deserializeRange(
      { start: "/p[1]", startOffset: 0, end: "/p[1]", endOffset: 999 },
      root,
    );
    expect(back).not.toBeNull();
    expect(back!.toString()).toBe("short");
  });
});

describe("serialize → deserialize round trip", () => {
  it("string of cases survives a round trip", () => {
    setHtml("<h1>Heading</h1><p>This is a <em>nested</em> paragraph.</p><p>Second.</p>");
    const cases = [
      { selector: "h1", from: 0, to: 7 },
      { selector: "p", from: 0, to: 9, idx: 0 },
      { selector: "em", from: 0, to: 6 },
      { selector: "p", from: 0, to: 7, idx: 1 },
    ];
    for (const c of cases) {
      const els = root.querySelectorAll(c.selector);
      const target = els[c.idx ?? 0]!;
      const textNode = target.firstChild;
      expect(textNode?.nodeType).toBe(Node.TEXT_NODE);
      const range = selectText(textNode!, c.from, c.to);
      const ser = serializeRange(range, root);
      expect(ser).not.toBeNull();
      const back = deserializeRange(ser!, root);
      expect(back).not.toBeNull();
      expect(back!.toString()).toBe(range.toString());
    }
  });

  it("preserves a selection spanning multiple paragraphs", () => {
    setHtml("<p>first paragraph</p><p>middle one</p><p>last paragraph</p>");
    const ps = root.querySelectorAll("p");
    const range = document.createRange();
    range.setStart(ps[0]!.firstChild!, 6);
    range.setEnd(ps[2]!.firstChild!, 4);
    expect(range.toString()).toBe("paragraphmiddle onelast");
    const ser = serializeRange(range, root);
    expect(ser).toEqual({
      start: "/p[1]",
      startOffset: 6,
      end: "/p[3]",
      endOffset: 4,
    });
    const back = deserializeRange(ser!, root);
    expect(back).not.toBeNull();
    expect(back!.toString()).toBe(range.toString());
  });

  it("preserves a multi-block selection ending inside a nested element", () => {
    setHtml("<p>alpha beta</p><p>gamma <em>delta</em> epsilon</p>");
    const ps = root.querySelectorAll("p");
    const em = root.querySelector("em")!;
    const range = document.createRange();
    range.setStart(ps[0]!.firstChild!, 6);
    range.setEnd(em.firstChild!, 3);
    const ser = serializeRange(range, root);
    expect(ser).toEqual({
      start: "/p[1]",
      startOffset: 6,
      end: "/p[2]/em[1]",
      endOffset: 3,
    });
    const back = deserializeRange(ser!, root);
    expect(back).not.toBeNull();
    expect(back!.toString()).toBe(range.toString());
  });
});
