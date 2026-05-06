# Annotations Implementation Plan (Phase 4b of 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inside the reader, render existing annotations as highlights, let the user select text and create new highlights with optional notes, view/edit/delete existing annotations. Range serialization round-trips Wallabag's XPath format faithfully so highlights survive across reopens and devices.

**Architecture:** All range work happens inside the WebView/iframe. A pure-JS `range-serializer` module (shipped as a string into the bridge) converts a browser `Range` to/from Wallabag's `{ start: "xpath", startOffset, end: "xpath", endOffset }` format. The bridge gains three new message kinds: `selection` (text + ranges), `annotation:click` (id), and `annotation:created` (id, when bridge wraps a new mark). The host responds with `render-annotations` (push existing) and `wrap-selection` (turn a captured selection into a `<mark>`). New annotations are optimistically inserted via Phase 2's annotation repo + outbox; the drainer's existing handlers do the rest.

**Tech Stack:** No new deps. Reuses Phase 1 (auth + UI primitives), Phase 2 (annotations repo + outbox + drainer), Phase 4 (reader pipeline + bridge + ReaderContent + ActionBar).

**Reference spec:** `docs/superpowers/specs/2026-05-06-wallabag-expo-client-design.md` §8.2 (annotations).

**Scope decisions:**
- **Single-block highlights only.** A highlight whose `start` and `end` xpath resolve to the same block element. Multi-block highlights (selection spans `<p>` boundaries) are explicitly deferred — they're rare in practice and add an order of magnitude of complexity to the serializer.
- **Pure XPath serialization.** No `rangy` dependency. The serializer is ~80 lines of careful JS, fully unit-tested in jsdom.
- **Render existing annotations always.** Even multi-block annotations from the server render their `start` block as a fallback (better than nothing); the bridge logs a warning. Re-saving them stays single-block.
- **Note editing + delete in Phase 4b.** Read-modify-write of annotation text via PUT, soft-delete via the existing repo's `pending_op = 'delete'` flow.

---

## File map for this plan

```
src/
├── reader/
│   ├── range-serializer.ts          # NEW: pure JS, runs in node + browser; TDD-heavy
│   ├── range-serializer.test.ts     # alongside (jsdom env)
│   ├── annotations-bridge.ts        # NEW: JS string injected into reader; uses range-serializer
│   ├── bridge.ts                    # MODIFY: include annotations bridge
│   ├── pipeline.ts                  # MODIFY: accept + inject existing annotations
│   └── ReaderContent.tsx            # MODIFY: new message kinds (selection, annotation:click, annotation:created)
├── components/
│   ├── SelectionToolbar.tsx         # NEW: floating "Highlight" button
│   └── AnnotationSheet.tsx          # NEW: view/edit/delete annotation
└── hooks/
    ├── useCreateAnnotation.ts       # NEW: optimistic insert + outbox enqueue
    ├── useUpdateAnnotation.ts       # NEW
    └── useDeleteAnnotation.ts       # NEW

app/(app)/article/[id].tsx           # MODIFY: wire selection toolbar, sheet, render existing

tests/unit/
├── range-serializer.test.ts         # the bug magnet — many cases
└── hook-annotation-mutations.test.ts
```

9 tasks total. Range serializer dominates the test surface.

---

## Task 1: Range serializer

**Files:** Create `src/reader/range-serializer.ts`. Test: `tests/unit/range-serializer.test.ts`.

The serializer is a small pure-JS module that:

- Given a `Range` and a root element, produces `{ start, startOffset, end, endOffset }` where `start`/`end` are XPath strings relative to root.
- Given a serialized record and a root element, produces a `Range` (or null if it can't resolve).
- Single-block only: if the range crosses block boundaries, it clamps to the start element. The bridge logs a warning when this happens.

Wallabag's XPath format follows annotator.js: `/p[2]` is the second `<p>` child of the root. `text()` text-node hits use `/p[2]/text()[1]` form. We'll keep our serializer's surface consistent with that.

- [ ] **Step 1: Failing test scaffold** at `tests/unit/range-serializer.test.ts`. Multiple cases — each one has its own block:

```ts
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
    expect(ser).toEqual({
      start: "/p[1]",
      startOffset: 0,
      end: "/p[1]",
      endOffset: 11,
    });
  });

  it("nth paragraph", () => {
    setHtml("<p>a</p><p>b</p><p>cdef</p>");
    const target = root.querySelectorAll("p")[2];
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

  it("clamps multi-block ranges to the start element", () => {
    setHtml("<p>first</p><p>second</p>");
    const ps = root.querySelectorAll("p");
    const range = document.createRange();
    range.setStart(ps[0]!.firstChild!, 1);
    range.setEnd(ps[1]!.firstChild!, 3);
    const ser = serializeRange(range, root);
    expect(ser?.start).toBe("/p[1]");
    expect(ser?.end).toBe("/p[1]");
    expect(ser?.startOffset).toBe(1);
    // Endpoint should be clamped to the end of the first block's text.
    expect(ser?.endOffset).toBe(5);
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
      deserializeRange(
        { start: "/p[5]", startOffset: 0, end: "/p[5]", endOffset: 1 },
        root,
      ),
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
    setHtml(
      "<h1>Heading</h1><p>This is a <em>nested</em> paragraph.</p><p>Second.</p>",
    );
    const cases = [
      { selector: "h1", from: 0, to: 7 },
      { selector: "p", from: 0, to: 9, idx: 0 },
      { selector: "em", from: 0, to: 6 },
      { selector: "p", from: 0, to: 7, idx: 1 },
    ];
    for (const c of cases) {
      const els = root.querySelectorAll(c.selector);
      const target = els[c.idx ?? 0]!;
      // Find the first text-node descendant for the from/to offsets.
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
});
```

- [ ] **Step 2: Run** — expect FAIL (module missing).

- [ ] **Step 3: Implement `src/reader/range-serializer.ts`**:

```ts
export type SerializedRange = {
  start: string;
  startOffset: number;
  end: string;
  endOffset: number;
};

/**
 * Build an XPath like "/p[2]/span[1]" from `node` to `root` (exclusive).
 * Element nodes are addressed with [n]; text nodes are addressed via their
 * parent element (we represent the whole element's text run, since callers
 * pass element-relative offsets after walking).
 */
function elementPathFromRoot(node: Node, root: Node): string | null {
  const parts: string[] = [];
  let n: Node | null = node;
  while (n && n !== root) {
    if (n.nodeType === Node.ELEMENT_NODE) {
      const el = n as Element;
      const tag = el.tagName.toLowerCase();
      // Compute 1-based index among siblings of the same tag.
      let idx = 1;
      let prev: Element | null = el.previousElementSibling;
      while (prev) {
        if (prev.tagName === el.tagName) idx += 1;
        prev = prev.previousElementSibling;
      }
      parts.unshift(`${tag}[${idx}]`);
    }
    n = n.parentNode;
  }
  if (n !== root) return null;
  return "/" + parts.join("/");
}

/**
 * Walk an element subtree, accumulating text into a single "block string"
 * that mirrors how Wallabag stores offsets (offset is the character index
 * within the concatenated text of the block element).
 *
 * Returns the running offset corresponding to a target text node + offset.
 */
function elementOffsetFor(
  block: Element,
  targetTextNode: Text,
  targetOffset: number,
): number {
  let acc = 0;
  let found = false;
  function walk(node: Node) {
    if (found) return;
    if (node.nodeType === Node.TEXT_NODE) {
      if (node === targetTextNode) {
        acc += targetOffset;
        found = true;
        return;
      }
      acc += (node as Text).data.length;
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      for (let i = 0; i < node.childNodes.length; i++) {
        walk(node.childNodes[i] as Node);
      }
    }
  }
  walk(block);
  return acc;
}

/** Total text length within an element (used for clamping). */
function elementTextLength(block: Element): number {
  let acc = 0;
  function walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      acc += (node as Text).data.length;
      return;
    }
    for (let i = 0; i < node.childNodes.length; i++) {
      walk(node.childNodes[i] as Node);
    }
  }
  walk(block);
  return acc;
}

/**
 * The "block" we anchor against is either the deepest *element* ancestor
 * that contains the entire range (single-block case), or — for multi-block
 * ranges — we clamp to the start node's parent element and pretend the
 * range ended at the end of that block.
 */
function commonBlockAncestor(range: Range, root: Node): Element | null {
  const ca = range.commonAncestorContainer;
  let el: Node | null =
    ca.nodeType === Node.ELEMENT_NODE ? ca : ca.parentNode;
  while (el && el !== root) {
    if (el.nodeType === Node.ELEMENT_NODE) return el as Element;
    el = el.parentNode;
  }
  return null;
}

function startBlockElement(node: Node, root: Node): Element | null {
  let el: Node | null =
    node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode;
  while (el && el !== root) {
    if (el.nodeType === Node.ELEMENT_NODE) return el as Element;
    el = el.parentNode;
  }
  return null;
}

export function serializeRange(range: Range, root: Element): SerializedRange | null {
  if (!range || range.collapsed) return null;

  const startBlock = startBlockElement(range.startContainer, root);
  const endBlock = startBlockElement(range.endContainer, root);
  if (!startBlock) return null;

  const startPath = elementPathFromRoot(startBlock, root);
  if (!startPath) return null;

  // Compute startOffset relative to startBlock's concatenated text.
  let startOffset: number;
  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    startOffset = elementOffsetFor(
      startBlock,
      range.startContainer as Text,
      range.startOffset,
    );
  } else {
    // Range starts at an element boundary. Walk its first text descendant.
    startOffset = 0;
  }

  // Single-block path: if start === end ancestor, end is also in startBlock.
  if (endBlock && startBlock === endBlock) {
    let endOffset: number;
    if (range.endContainer.nodeType === Node.TEXT_NODE) {
      endOffset = elementOffsetFor(
        startBlock,
        range.endContainer as Text,
        range.endOffset,
      );
    } else {
      endOffset = elementTextLength(startBlock);
    }
    return {
      start: startPath,
      startOffset,
      end: startPath,
      endOffset,
    };
  }

  // Multi-block: clamp end to startBlock's end of text. Bridge will warn.
  return {
    start: startPath,
    startOffset,
    end: startPath,
    endOffset: elementTextLength(startBlock),
  };
}

/** Resolve "/p[2]/span[1]" against root → an Element (or null). */
function resolveElementPath(path: string, root: Element): Element | null {
  if (!path.startsWith("/")) return null;
  const segments = path.slice(1).split("/").filter(Boolean);
  let cur: Element = root;
  for (const seg of segments) {
    const m = /^([a-zA-Z][a-zA-Z0-9]*)(?:\[(\d+)\])?$/.exec(seg);
    if (!m) return null;
    const tag = m[1]!.toLowerCase();
    const wantIdx = m[2] ? parseInt(m[2], 10) : 1;
    let idx = 0;
    let found: Element | null = null;
    for (const child of Array.from(cur.children)) {
      if (child.tagName.toLowerCase() === tag) {
        idx += 1;
        if (idx === wantIdx) {
          found = child;
          break;
        }
      }
    }
    if (!found) return null;
    cur = found;
  }
  return cur;
}

/**
 * Walk `block` accumulating text characters and locate the (Text node, offset)
 * pair corresponding to a given block-relative offset. If `offset` exceeds
 * the block's text length, returns the last text node + its end.
 */
function locateOffsetInBlock(
  block: Element,
  offset: number,
): { node: Text; offset: number } | null {
  let acc = 0;
  let lastText: Text | null = null;
  function walk(node: Node): { node: Text; offset: number } | null {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node as Text;
      lastText = t;
      const len = t.data.length;
      if (offset <= acc + len) {
        return { node: t, offset: offset - acc };
      }
      acc += len;
      return null;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      for (let i = 0; i < node.childNodes.length; i++) {
        const found = walk(node.childNodes[i] as Node);
        if (found) return found;
      }
    }
    return null;
  }
  const found = walk(block);
  if (found) return found;
  if (lastText) return { node: lastText, offset: (lastText as Text).data.length };
  return null;
}

export function deserializeRange(
  ser: SerializedRange,
  root: Element,
): Range | null {
  const startBlock = resolveElementPath(ser.start, root);
  const endBlock = resolveElementPath(ser.end, root);
  if (!startBlock || !endBlock) return null;

  const start = locateOffsetInBlock(startBlock, ser.startOffset);
  const end = locateOffsetInBlock(endBlock, ser.endOffset);
  if (!start || !end) return null;

  const range = document.createRange();
  try {
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
  } catch {
    return null;
  }
  return range;
}
```

- [ ] **Step 4: Run tests** — expect every case in the file passing.

- [ ] **Step 5: Commit**:

```
feat(reader): range serializer for Wallabag XPath annotations
```

---

## Task 2: Annotation mutation hooks

**Files:** Create `src/hooks/useCreateAnnotation.ts`, `useUpdateAnnotation.ts`, `useDeleteAnnotation.ts`. Test: `tests/unit/hook-annotation-mutations.test.ts`.

These hooks mirror Phase 3's mutation hook pattern: a standalone `*Action` function plus a `use*` mutation wrapper. The actions call into the existing annotations repo + outbox; the existing drainer handles the API side.

- [ ] **Step 1: Failing test** at `tests/unit/hook-annotation-mutations.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createBetterSqliteDriver } from "@/db/driver-better-sqlite3";
import { runMigrations } from "@/db/migrations";
import type { DbDriver } from "@/db/driver";

const secure = new Map<string, string>();
const asyncMem = new Map<string, string>();
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (k: string) => secure.get(k) ?? null),
  setItemAsync: vi.fn(async (k: string, v: string) => void secure.set(k, v)),
  deleteItemAsync: vi.fn(async (k: string) => void secure.delete(k)),
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (k: string) => asyncMem.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => void asyncMem.set(k, v)),
    removeItem: vi.fn(async (k: string) => void asyncMem.delete(k)),
  },
}));

import { setDbForTesting } from "@/db";
import { createAnnotationAction } from "@/hooks/useCreateAnnotation";
import { updateAnnotationAction } from "@/hooks/useUpdateAnnotation";
import { deleteAnnotationAction } from "@/hooks/useDeleteAnnotation";

let db: DbDriver;

beforeEach(async () => {
  secure.clear();
  asyncMem.clear();
  db = await createBetterSqliteDriver(":memory:");
  await runMigrations(db);
  await db.run("INSERT INTO articles (id, url) VALUES (1, 'https://x')");
  setDbForTesting(db);
});

const ranges = [
  { start: "/p[1]", startOffset: 0, end: "/p[1]", endOffset: 5 },
];

describe("createAnnotationAction", () => {
  it("inserts a row with negative tempId and pending_op='create'", async () => {
    const id = await createAnnotationAction({
      articleId: 1,
      quote: "hello",
      ranges,
      text: "first note",
    });
    expect(id).toBeLessThan(0);
    const row = await db.get<{
      id: number;
      article_id: number;
      quote: string;
      ranges_json: string;
      text: string | null;
      pending_op: string | null;
    }>("SELECT id, article_id, quote, ranges_json, text, pending_op FROM annotations WHERE id = ?", [id]);
    expect(row?.article_id).toBe(1);
    expect(row?.quote).toBe("hello");
    expect(JSON.parse(row!.ranges_json)).toEqual(ranges);
    expect(row?.text).toBe("first note");
    expect(row?.pending_op).toBe("create");
  });

  it("enqueues createAnnotation with tempId, entryId, quote, ranges, text", async () => {
    const id = await createAnnotationAction({
      articleId: 1,
      quote: "hello",
      ranges,
      text: null,
    });
    const job = await db.get<{ op: string; payload_json: string }>(
      "SELECT op, payload_json FROM outbox LIMIT 1",
    );
    expect(job?.op).toBe("createAnnotation");
    expect(JSON.parse(job!.payload_json)).toEqual({
      tempId: id,
      entryId: 1,
      quote: "hello",
      ranges,
      text: null,
    });
  });
});

describe("updateAnnotationAction", () => {
  it("updates text + sets pending_op='update' + enqueues", async () => {
    await db.run(
      `INSERT INTO annotations (id, article_id, quote, ranges_json, text, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [42, 1, "x", JSON.stringify(ranges), "old", "2026-05-01", "2026-05-01"],
    );
    await updateAnnotationAction(42, "new note");
    const row = await db.get<{ text: string; pending_op: string }>(
      "SELECT text, pending_op FROM annotations WHERE id = 42",
    );
    expect(row?.text).toBe("new note");
    expect(row?.pending_op).toBe("update");
    const job = await db.get<{ op: string; payload_json: string }>(
      "SELECT op, payload_json FROM outbox LIMIT 1",
    );
    expect(job?.op).toBe("updateAnnotation");
    expect(JSON.parse(job!.payload_json)).toEqual({ id: 42, text: "new note" });
  });
});

describe("deleteAnnotationAction", () => {
  it("marks delete + enqueues; row stays pending_op='delete' until drained", async () => {
    await db.run(
      `INSERT INTO annotations (id, article_id, quote, ranges_json, text, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [42, 1, "x", JSON.stringify(ranges), null, "2026-05-01", "2026-05-01"],
    );
    await deleteAnnotationAction(42);
    const row = await db.get<{ pending_op: string }>(
      "SELECT pending_op FROM annotations WHERE id = 42",
    );
    expect(row?.pending_op).toBe("delete");
    const job = await db.get<{ op: string; payload_json: string }>(
      "SELECT op, payload_json FROM outbox LIMIT 1",
    );
    expect(job?.op).toBe("deleteAnnotation");
    expect(JSON.parse(job!.payload_json)).toEqual({ id: 42 });
  });
});
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Implement `src/hooks/useCreateAnnotation.ts`**:

```ts
import { useMutation } from "@tanstack/react-query";
import { getDb } from "@/db";
import { createAnnotation as repoCreate } from "@/db/repos/annotations";
import { enqueue } from "@/db/repos/outbox";
import { dataEvents } from "@/sync/events";
import type { Annotation } from "@/api/types";

export type AnnotationRange = Annotation["ranges"][number];

export async function createAnnotationAction(args: {
  articleId: number;
  quote: string;
  ranges: AnnotationRange[];
  text: string | null;
}): Promise<number> {
  const db = await getDb();
  const tempId = await repoCreate(db, {
    article_id: args.articleId,
    quote: args.quote,
    ranges_json: JSON.stringify(args.ranges),
    text: args.text,
  });
  await enqueue(db, "createAnnotation", {
    tempId,
    entryId: args.articleId,
    quote: args.quote,
    ranges: args.ranges,
    text: args.text,
  });
  dataEvents.emit({ kind: "annotations", articleId: args.articleId });
  return tempId;
}

export function useCreateAnnotation() {
  return useMutation({
    mutationFn: (args: {
      articleId: number;
      quote: string;
      ranges: AnnotationRange[];
      text: string | null;
    }) => createAnnotationAction(args),
  });
}
```

- [ ] **Step 4: Implement `src/hooks/useUpdateAnnotation.ts`**:

```ts
import { useMutation } from "@tanstack/react-query";
import { getDb } from "@/db";
import { enqueue } from "@/db/repos/outbox";
import { dataEvents } from "@/sync/events";

export async function updateAnnotationAction(
  id: number,
  text: string | null,
): Promise<void> {
  const db = await getDb();
  await db.run(
    `UPDATE annotations SET text = ?, pending_op = 'update', updated_at = ? WHERE id = ?`,
    [text, new Date().toISOString(), id],
  );
  await enqueue(db, "updateAnnotation", { id, text });
  const row = await db.get<{ article_id: number }>(
    "SELECT article_id FROM annotations WHERE id = ?",
    [id],
  );
  if (row) dataEvents.emit({ kind: "annotations", articleId: row.article_id });
}

export function useUpdateAnnotation() {
  return useMutation({
    mutationFn: ({ id, text }: { id: number; text: string | null }) =>
      updateAnnotationAction(id, text),
  });
}
```

- [ ] **Step 5: Implement `src/hooks/useDeleteAnnotation.ts`**:

```ts
import { useMutation } from "@tanstack/react-query";
import { getDb } from "@/db";
import { deleteAnnotation as repoDelete } from "@/db/repos/annotations";
import { enqueue } from "@/db/repos/outbox";
import { dataEvents } from "@/sync/events";

export async function deleteAnnotationAction(id: number): Promise<void> {
  const db = await getDb();
  const row = await db.get<{ article_id: number }>(
    "SELECT article_id FROM annotations WHERE id = ?",
    [id],
  );
  await repoDelete(db, id);
  await enqueue(db, "deleteAnnotation", { id });
  if (row) dataEvents.emit({ kind: "annotations", articleId: row.article_id });
}

export function useDeleteAnnotation() {
  return useMutation({
    mutationFn: (id: number) => deleteAnnotationAction(id),
  });
}
```

- [ ] **Step 6: Run tests** — expect 4 passed across the new test file.

- [ ] **Step 7: Commit**:

```
feat(hooks): annotation mutation hooks (create, update, delete)
```

---

## Task 3: Annotations bridge JS extension

**Files:** Create `src/reader/annotations-bridge.ts`. Modify `src/reader/bridge.ts`.

The annotations bridge is a JS string that runs inside the WebView/iframe alongside the existing bridge. It depends on the range-serializer, so we inline that serializer's source string into the bridge. To avoid duplicating maintenance, we expose `RANGE_SERIALIZER_SOURCE` from `range-serializer.ts` (as a separate `.ts` constant), and the bridge prepends it.

- [ ] **Step 1: Add `RANGE_SERIALIZER_SOURCE` export** to `src/reader/range-serializer.ts`. Read the file, append at the bottom:

```ts
/**
 * Source string of the serializer suitable for injection into a WebView/iframe.
 * Mirrors the exported functions but as a self-contained IIFE. The browser-side
 * doesn't need TypeScript or imports.
 */
export const RANGE_SERIALIZER_SOURCE = `
(function () {
  function elementPathFromRoot(node, root) {
    var parts = [];
    var n = node;
    while (n && n !== root) {
      if (n.nodeType === 1) {
        var tag = n.tagName.toLowerCase();
        var idx = 1;
        var prev = n.previousElementSibling;
        while (prev) {
          if (prev.tagName === n.tagName) idx += 1;
          prev = prev.previousElementSibling;
        }
        parts.unshift(tag + '[' + idx + ']');
      }
      n = n.parentNode;
    }
    if (n !== root) return null;
    return '/' + parts.join('/');
  }
  function elementOffsetFor(block, target, targetOffset) {
    var acc = 0, found = false;
    function walk(node) {
      if (found) return;
      if (node.nodeType === 3) {
        if (node === target) { acc += targetOffset; found = true; return; }
        acc += node.data.length;
        return;
      }
      if (node.nodeType === 1) {
        for (var i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]);
      }
    }
    walk(block);
    return acc;
  }
  function elementTextLength(block) {
    var acc = 0;
    function walk(node) {
      if (node.nodeType === 3) { acc += node.data.length; return; }
      for (var i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]);
    }
    walk(block);
    return acc;
  }
  function startBlockElement(node, root) {
    var el = node.nodeType === 1 ? node : node.parentNode;
    while (el && el !== root) {
      if (el.nodeType === 1) return el;
      el = el.parentNode;
    }
    return null;
  }
  function serializeRange(range, root) {
    if (!range || range.collapsed) return null;
    var startBlock = startBlockElement(range.startContainer, root);
    var endBlock = startBlockElement(range.endContainer, root);
    if (!startBlock) return null;
    var startPath = elementPathFromRoot(startBlock, root);
    if (!startPath) return null;
    var startOffset = range.startContainer.nodeType === 3
      ? elementOffsetFor(startBlock, range.startContainer, range.startOffset)
      : 0;
    if (endBlock && startBlock === endBlock) {
      var endOffset = range.endContainer.nodeType === 3
        ? elementOffsetFor(startBlock, range.endContainer, range.endOffset)
        : elementTextLength(startBlock);
      return { start: startPath, startOffset: startOffset, end: startPath, endOffset: endOffset };
    }
    return { start: startPath, startOffset: startOffset, end: startPath, endOffset: elementTextLength(startBlock) };
  }
  function resolveElementPath(path, root) {
    if (!path || path[0] !== '/') return null;
    var segments = path.slice(1).split('/').filter(Boolean);
    var cur = root;
    for (var i = 0; i < segments.length; i++) {
      var m = /^([a-zA-Z][a-zA-Z0-9]*)(?:\\[(\\d+)\\])?$/.exec(segments[i]);
      if (!m) return null;
      var tag = m[1].toLowerCase();
      var want = m[2] ? parseInt(m[2], 10) : 1;
      var found = null;
      var idx = 0;
      var children = cur.children;
      for (var j = 0; j < children.length; j++) {
        if (children[j].tagName.toLowerCase() === tag) {
          idx += 1;
          if (idx === want) { found = children[j]; break; }
        }
      }
      if (!found) return null;
      cur = found;
    }
    return cur;
  }
  function locateOffsetInBlock(block, offset) {
    var acc = 0;
    var lastText = null;
    function walk(node) {
      if (node.nodeType === 3) {
        lastText = node;
        var len = node.data.length;
        if (offset <= acc + len) return { node: node, offset: offset - acc };
        acc += len;
        return null;
      }
      if (node.nodeType === 1) {
        for (var i = 0; i < node.childNodes.length; i++) {
          var f = walk(node.childNodes[i]);
          if (f) return f;
        }
      }
      return null;
    }
    var f = walk(block);
    if (f) return f;
    if (lastText) return { node: lastText, offset: lastText.data.length };
    return null;
  }
  function deserializeRange(ser, root) {
    var sb = resolveElementPath(ser.start, root);
    var eb = resolveElementPath(ser.end, root);
    if (!sb || !eb) return null;
    var s = locateOffsetInBlock(sb, ser.startOffset);
    var e = locateOffsetInBlock(eb, ser.endOffset);
    if (!s || !e) return null;
    var range = document.createRange();
    try { range.setStart(s.node, s.offset); range.setEnd(e.node, e.offset); }
    catch (_) { return null; }
    return range;
  }
  window.__rangeSerializer = { serializeRange: serializeRange, deserializeRange: deserializeRange };
})();
`;
```

- [ ] **Step 2: Implement `src/reader/annotations-bridge.ts`**:

```ts
import { RANGE_SERIALIZER_SOURCE } from "./range-serializer";

/**
 * Annotation bridge: depends on `window.__rangeSerializer` (defined by
 * RANGE_SERIALIZER_SOURCE). Listens for selection changes, posts
 * { kind: "selection", text, ranges } when the user has selected text
 * that fits a single block. Receives { kind: "render-annotations", items }
 * to wrap existing annotations on load, and { kind: "wrap-selection",
 * tempId, ranges } to mark a fresh highlight.
 *
 * Posted message kinds:
 *  - { kind: "selection", text: string, ranges: SerializedRange }
 *  - { kind: "selection-cleared" }
 *  - { kind: "annotation:click", id: number }
 *  - { kind: "annotation:created", tempId: number, success: boolean }
 *  - { kind: "annotation:render-warning", id: number, reason: string }
 *
 * Received message kinds:
 *  - { kind: "render-annotations", items: { id: number, ranges: SerializedRange }[] }
 *  - { kind: "wrap-selection", tempId: number, ranges: SerializedRange }
 *  - { kind: "unwrap-annotation", id: number }
 */
export const ANNOTATIONS_BRIDGE_JS = `${RANGE_SERIALIZER_SOURCE}
(function () {
  var article = document.querySelector('article') || document.body;
  var rs = window.__rangeSerializer;

  var isNative = typeof window.ReactNativeWebView !== 'undefined';
  function send(msg) {
    var json = JSON.stringify(msg);
    if (isNative) window.ReactNativeWebView.postMessage(json);
    else if (window.parent && window.parent !== window) window.parent.postMessage(msg, '*');
  }

  function wrapRange(range, id) {
    if (!range || range.collapsed) return false;
    try {
      var mark = document.createElement('mark');
      mark.setAttribute('data-annotation-id', String(id));
      mark.style.cursor = 'pointer';
      range.surroundContents(mark);
      mark.addEventListener('click', function (e) {
        e.preventDefault();
        send({ kind: 'annotation:click', id: id });
      });
      return true;
    } catch (_) {
      // Range crosses element boundaries — surroundContents fails. Fall back
      // to walking text nodes inside the range and wrapping each one.
      try {
        var walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, null);
        var textNodes = [];
        while (walker.nextNode()) {
          var t = walker.currentNode;
          if (range.intersectsNode(t)) textNodes.push(t);
        }
        for (var i = 0; i < textNodes.length; i++) {
          var t2 = textNodes[i];
          var subRange = document.createRange();
          subRange.selectNodeContents(t2);
          if (t2 === range.startContainer) subRange.setStart(t2, range.startOffset);
          if (t2 === range.endContainer) subRange.setEnd(t2, range.endOffset);
          if (subRange.collapsed) continue;
          var subMark = document.createElement('mark');
          subMark.setAttribute('data-annotation-id', String(id));
          subMark.style.cursor = 'pointer';
          subRange.surroundContents(subMark);
          subMark.addEventListener('click', function (e) {
            e.preventDefault();
            send({ kind: 'annotation:click', id: id });
          });
        }
        return true;
      } catch (e2) {
        send({ kind: 'annotation:render-warning', id: id, reason: String(e2) });
        return false;
      }
    }
  }

  function unwrap(id) {
    var marks = article.querySelectorAll('mark[data-annotation-id="' + id + '"]');
    for (var i = 0; i < marks.length; i++) {
      var m = marks[i];
      var parent = m.parentNode;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
    }
  }

  // Selection events.
  var selectionTimer = null;
  function reportSelection() {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      send({ kind: 'selection-cleared' });
      return;
    }
    var range = sel.getRangeAt(0);
    var ser = rs.serializeRange(range, article);
    if (!ser) {
      send({ kind: 'selection-cleared' });
      return;
    }
    send({ kind: 'selection', text: range.toString(), ranges: ser });
  }
  document.addEventListener('selectionchange', function () {
    if (selectionTimer) clearTimeout(selectionTimer);
    selectionTimer = setTimeout(reportSelection, 200);
  });

  function handleHostMessage(data) {
    if (!data || typeof data !== 'object') return;
    if (data.kind === 'render-annotations' && Array.isArray(data.items)) {
      for (var i = 0; i < data.items.length; i++) {
        var item = data.items[i];
        var range = rs.deserializeRange(item.ranges, article);
        if (range) wrapRange(range, item.id);
        else send({ kind: 'annotation:render-warning', id: item.id, reason: 'unresolved-xpath' });
      }
    } else if (data.kind === 'wrap-selection') {
      var sel = window.getSelection();
      var range2 = null;
      if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
        range2 = sel.getRangeAt(0);
      } else if (data.ranges) {
        range2 = rs.deserializeRange(data.ranges, article);
      }
      var ok = range2 ? wrapRange(range2, data.tempId) : false;
      send({ kind: 'annotation:created', tempId: data.tempId, success: ok });
      if (sel) sel.removeAllRanges();
    } else if (data.kind === 'unwrap-annotation') {
      unwrap(data.id);
    }
  }

  if (isNative) {
    document.addEventListener('message', function (e) {
      try { handleHostMessage(JSON.parse(e.data)); } catch (_) {}
    });
    window.addEventListener('message', function (e) {
      try { handleHostMessage(typeof e.data === 'string' ? JSON.parse(e.data) : e.data); } catch (_) {}
    });
  } else {
    window.addEventListener('message', function (e) { handleHostMessage(e.data); });
  }
})();
`;
```

- [ ] **Step 3: Modify `src/reader/bridge.ts`** to also export the annotations bridge as a combined string. Read it first; append:

```ts
import { ANNOTATIONS_BRIDGE_JS } from "./annotations-bridge";

export const READER_BRIDGE_FULL_JS = `${READER_BRIDGE_JS}\n${ANNOTATIONS_BRIDGE_JS}`;
```

- [ ] **Step 4: Verify** typecheck + lint + tests + web export.

- [ ] **Step 5: Commit**:

```
feat(reader): annotations bridge JS (selection events, render existing, wrap new)
```

---

## Task 4: Pipeline injects existing annotations

**Files:** Modify `src/reader/pipeline.ts`.

The reader builds the HTML once. Existing annotations are pushed via a `render-annotations` message after the bridge sends `ready` — this happens in the host (`ArticleRoute`), not the pipeline. But the pipeline switches to the FULL bridge so the message handlers exist.

- [ ] **Step 1: Modify `src/reader/pipeline.ts`**. Read it; replace the `<script>${READER_BRIDGE_JS}</script>` line with `<script>${READER_BRIDGE_FULL_JS}</script>`, and update the import:

```ts
import { READER_BRIDGE_FULL_JS } from "./bridge";
// remove: import { READER_BRIDGE_JS } from "./bridge";
```

- [ ] **Step 2: Verify** all four checks + web export.

- [ ] **Step 3: Commit**:

```
feat(reader): pipeline ships the full bridge (scroll + annotations)
```

---

## Task 5: ReaderContent — new bridge message handling

**Files:** Modify `src/reader/ReaderContent.tsx`.

Extend `BridgeMessage` and `parseMsg` to recognise `selection`, `selection-cleared`, `annotation:click`, `annotation:created`, `annotation:render-warning`. Pass them through new optional callbacks. Add an imperative API `postToBridge(message)` so the host can send `render-annotations`, `wrap-selection`, `unwrap-annotation`.

- [ ] **Step 1: Modify `src/reader/ReaderContent.tsx`**. Read the current file. Replace it with:

```tsx
import { Platform } from "react-native";
import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";

export type SerializedRange = {
  start: string;
  startOffset: number;
  end: string;
  endOffset: number;
};

export type BridgeMessage =
  | { kind: "scroll"; position: number }
  | { kind: "ready" }
  | { kind: "selection"; text: string; ranges: SerializedRange }
  | { kind: "selection-cleared" }
  | { kind: "annotation:click"; id: number }
  | { kind: "annotation:created"; tempId: number; success: boolean }
  | { kind: "annotation:render-warning"; id: number; reason: string };

export type HostMessage =
  | { kind: "restore-scroll"; position: number }
  | { kind: "render-annotations"; items: { id: number; ranges: SerializedRange }[] }
  | { kind: "wrap-selection"; tempId: number; ranges: SerializedRange }
  | { kind: "unwrap-annotation"; id: number };

export type ReaderContentHandle = {
  post: (message: HostMessage) => void;
};

export type ReaderContentProps = {
  document: string;
  initialScroll?: number;
  onScroll?: (position: number) => void;
  onSelection?: (text: string, ranges: SerializedRange) => void;
  onSelectionCleared?: () => void;
  onAnnotationClick?: (id: number) => void;
  onAnnotationCreated?: (tempId: number, success: boolean) => void;
  onAnnotationWarning?: (id: number, reason: string) => void;
};

function parseMsg(raw: unknown): BridgeMessage | null {
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!obj || typeof obj !== "object") return null;
    const o = obj as Record<string, unknown>;
    const kind = o["kind"];
    if (kind === "scroll" && typeof o["position"] === "number") {
      return { kind: "scroll", position: o["position"] };
    }
    if (kind === "ready") return { kind: "ready" };
    if (kind === "selection" && typeof o["text"] === "string" && o["ranges"]) {
      return {
        kind: "selection",
        text: o["text"] as string,
        ranges: o["ranges"] as SerializedRange,
      };
    }
    if (kind === "selection-cleared") return { kind: "selection-cleared" };
    if (kind === "annotation:click" && typeof o["id"] === "number") {
      return { kind: "annotation:click", id: o["id"] };
    }
    if (kind === "annotation:created" && typeof o["tempId"] === "number") {
      return {
        kind: "annotation:created",
        tempId: o["tempId"],
        success: !!o["success"],
      };
    }
    if (kind === "annotation:render-warning" && typeof o["id"] === "number") {
      return {
        kind: "annotation:render-warning",
        id: o["id"],
        reason: typeof o["reason"] === "string" ? o["reason"] : "",
      };
    }
    return null;
  } catch {
    return null;
  }
}

function dispatch(msg: BridgeMessage, props: ReaderContentProps) {
  switch (msg.kind) {
    case "scroll":
      props.onScroll?.(msg.position);
      return;
    case "selection":
      props.onSelection?.(msg.text, msg.ranges);
      return;
    case "selection-cleared":
      props.onSelectionCleared?.();
      return;
    case "annotation:click":
      props.onAnnotationClick?.(msg.id);
      return;
    case "annotation:created":
      props.onAnnotationCreated?.(msg.tempId, msg.success);
      return;
    case "annotation:render-warning":
      props.onAnnotationWarning?.(msg.id, msg.reason);
      return;
    case "ready":
      // handled by platform-specific impl below
      return;
  }
}

const ReaderContentWeb = forwardRef<ReaderContentHandle, ReaderContentProps>(
  function ReaderContentWeb(props, ref) {
    const innerRef = useRef<HTMLIFrameElement | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        post(message) {
          innerRef.current?.contentWindow?.postMessage(message, "*");
        },
      }),
      [],
    );

    useEffect(() => {
      const onMsg = (e: MessageEvent) => {
        const msg = parseMsg(e.data);
        if (!msg) return;
        if (
          msg.kind === "ready" &&
          typeof props.initialScroll === "number" &&
          innerRef.current?.contentWindow
        ) {
          innerRef.current.contentWindow.postMessage(
            { kind: "restore-scroll", position: props.initialScroll },
            "*",
          );
        }
        dispatch(msg, props);
      };
      window.addEventListener("message", onMsg);
      return () => window.removeEventListener("message", onMsg);
    }, [props]);

    return (
      <iframe
        ref={innerRef}
        title="Reader"
        srcDoc={props.document}
        sandbox="allow-same-origin allow-scripts"
        style={{ flex: 1, border: 0, width: "100%", height: "100%" } as React.CSSProperties}
      />
    );
  },
);

const ReaderContentNative = forwardRef<ReaderContentHandle, ReaderContentProps>(
  function ReaderContentNative(props, ref) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { WebView } = require("react-native-webview") as typeof import("react-native-webview");
    const innerRef = useRef<InstanceType<(typeof import("react-native-webview"))["WebView"]> | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        post(message) {
          const json = JSON.stringify(message).replace(/'/g, "\\'");
          innerRef.current?.injectJavaScript(
            `(function(){window.dispatchEvent(new MessageEvent('message',{data:'${json}'}))})();true;`,
          );
        },
      }),
      [],
    );

    return (
      <WebView
        ref={innerRef}
        originWhitelist={["*"]}
        source={{ html: props.document }}
        style={{ flex: 1, backgroundColor: "transparent" }}
        javaScriptEnabled
        domStorageEnabled={false}
        onMessage={(e) => {
          const msg = parseMsg(e.nativeEvent.data);
          if (!msg) return;
          if (msg.kind === "ready" && typeof props.initialScroll === "number") {
            const json = JSON.stringify({
              kind: "restore-scroll",
              position: props.initialScroll,
            }).replace(/'/g, "\\'");
            innerRef.current?.injectJavaScript(
              `(function(){window.dispatchEvent(new MessageEvent('message',{data:'${json}'}))})();true;`,
            );
          }
          dispatch(msg, props);
        }}
      />
    );
  },
);

export const ReaderContent = forwardRef<ReaderContentHandle, ReaderContentProps>(
  function ReaderContent(props, ref) {
    if (Platform.OS === "web") return <ReaderContentWeb {...props} ref={ref} />;
    return <ReaderContentNative {...props} ref={ref} />;
  },
);
```

- [ ] **Step 2: Verify** all four checks + web export.

- [ ] **Step 3: Commit**:

```
feat(reader): ReaderContent forwards annotation messages + exposes post() handle
```

---

## Task 6: SelectionToolbar component

**Files:** Create `src/components/SelectionToolbar.tsx`.

A floating action button that appears above the action bar when text is selected. Single button: "Highlight". Dismisses when selection clears.

- [ ] **Step 1: Implement**:

```tsx
import { Pressable, Text, View } from "react-native";

export type SelectionToolbarProps = {
  visible: boolean;
  onHighlight: () => void;
  onDismiss: () => void;
};

export function SelectionToolbar(props: SelectionToolbarProps) {
  if (!props.visible) return null;
  return (
    <View
      pointerEvents="box-none"
      className="absolute left-0 right-0 bottom-16 items-center"
    >
      <View className="flex-row items-center gap-2 bg-fg rounded-full px-2 py-1.5 shadow-lg">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="highlight selection"
          onPress={props.onHighlight}
          className="px-4 py-1.5"
        >
          <Text className="text-bg text-sm font-medium">Highlight</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="dismiss selection toolbar"
          onPress={props.onDismiss}
          className="px-3 py-1.5"
        >
          <Text className="text-bg text-sm">✕</Text>
        </Pressable>
      </View>
    </View>
  );
}
```

- [ ] **Step 2: Verify** all four checks.

- [ ] **Step 3: Commit**:

```
feat(reader): SelectionToolbar component (Highlight / dismiss)
```

---

## Task 7: AnnotationSheet component

**Files:** Create `src/components/AnnotationSheet.tsx`.

Bottom sheet shown when an existing annotation is tapped. Shows quote, an editable note, and Delete + Done.

- [ ] **Step 1: Implement**:

```tsx
import { useState, useEffect } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { useUpdateAnnotation } from "@/hooks/useUpdateAnnotation";
import { useDeleteAnnotation } from "@/hooks/useDeleteAnnotation";

export type AnnotationSheetProps = {
  annotation: {
    id: number;
    quote: string;
    text: string | null;
  } | null;
  onClose: () => void;
};

export function AnnotationSheet({ annotation, onClose }: AnnotationSheetProps) {
  const [text, setText] = useState("");
  const update = useUpdateAnnotation();
  const del = useDeleteAnnotation();

  useEffect(() => {
    setText(annotation?.text ?? "");
  }, [annotation?.id, annotation?.text]);

  if (!annotation) return null;

  const onDone = async () => {
    if (text !== (annotation.text ?? "")) {
      await update.mutateAsync({
        id: annotation.id,
        text: text.trim().length === 0 ? null : text,
      });
    }
    onClose();
  };

  const onDelete = async () => {
    await del.mutateAsync(annotation.id);
    onClose();
  };

  return (
    <View className="absolute left-0 right-0 bottom-0 px-6 py-6 border-t border-border bg-surface">
      <View className="flex-row items-center justify-between mb-3">
        <Text className="font-display text-fg text-xl">Highlight</Text>
        <Pressable accessibilityRole="button" onPress={onClose} className="px-2 py-1">
          <Text className="text-accent text-sm">Close</Text>
        </Pressable>
      </View>
      <View className="border-l-2 border-accent pl-3 mb-4">
        <Text className="text-muted text-sm" numberOfLines={3}>
          {annotation.quote}
        </Text>
      </View>
      <Text className="text-fg text-sm mb-2">Note (optional)</Text>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Add a note about this highlight…"
        placeholderTextColor="#888"
        multiline
        numberOfLines={3}
        className="border border-border bg-bg text-fg rounded-md px-3 py-2 mb-4"
      />
      <View className="flex-row gap-3">
        <Pressable
          accessibilityRole="button"
          onPress={onDelete}
          disabled={del.isPending}
          className="flex-1 border border-border rounded-md py-3 items-center"
        >
          {del.isPending ? <ActivityIndicator /> : <Text className="text-accent">Delete</Text>}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onDone}
          disabled={update.isPending}
          className="flex-1 bg-accent rounded-md py-3 items-center"
        >
          {update.isPending ? (
            <ActivityIndicator />
          ) : (
            <Text className="text-white font-medium">Done</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}
```

- [ ] **Step 2: Verify** all four checks.

- [ ] **Step 3: Commit**:

```
feat(reader): AnnotationSheet for viewing / editing / deleting highlights
```

---

## Task 8: Reader route integration

**Files:** Modify `app/(app)/article/[id].tsx`.

Wire selection events → toolbar → create annotation → wrap in bridge → annotation:click → sheet.

- [ ] **Step 1: Read the existing reader route file**, then replace it with:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useFullArticle } from "@/hooks/useFullArticle";
import { useReaderPrefs } from "@/hooks/useReaderPrefs";
import { useAnnotations } from "@/hooks/useAnnotations";
import {
  ReaderContent,
  type ReaderContentHandle,
  type SerializedRange,
} from "@/reader/ReaderContent";
import { buildReaderHtml } from "@/reader/pipeline";
import { ReaderPrefsSheet } from "@/components/ReaderPrefsSheet";
import { ActionBar } from "@/components/ActionBar";
import { SelectionToolbar } from "@/components/SelectionToolbar";
import { AnnotationSheet } from "@/components/AnnotationSheet";
import { ensureCached, buildLocalLookup } from "@/images/cache";
import { getDb } from "@/db";
import { setScrollPosition } from "@/db/repos/articles";
import { createAnnotationAction } from "@/hooks/useCreateAnnotation";

type SelectionState =
  | { active: false }
  | { active: true; text: string; ranges: SerializedRange };

export default function ArticleRoute() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const articleId = Number(id);
  const article = useFullArticle(articleId);
  const annotations = useAnnotations(articleId);
  const { prefs } = useReaderPrefs();

  const [showPrefs, setShowPrefs] = useState(false);
  const [imageLookup, setImageLookup] = useState<((src: string) => string | null) | null>(null);
  const [selection, setSelection] = useState<SelectionState>({ active: false });
  const [openAnnotation, setOpenAnnotation] = useState<{
    id: number;
    quote: string;
    text: string | null;
  } | null>(null);

  const readerRef = useRef<ReaderContentHandle | null>(null);
  const renderedAnnotationIds = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (article.data?.content == null) return;
    let cancelled = false;
    (async () => {
      const lookup = await buildLocalLookup(articleId);
      if (!cancelled) setImageLookup(() => lookup);
    })();
    return () => {
      cancelled = true;
    };
  }, [articleId, article.data?.content]);

  const built = useMemo(() => {
    if (!article.data || article.data.content == null || !imageLookup) return null;
    return buildReaderHtml({
      articleId,
      title: article.data.title,
      url: article.data.url,
      contentHtml: article.data.content,
      prefs,
      imageLookup,
    });
  }, [article.data, articleId, prefs, imageLookup]);

  useEffect(() => {
    if (!built || built.pendingImages.length === 0) return;
    void ensureCached(articleId, built.pendingImages).then(async (newMap) => {
      if (newMap.size === 0) return;
      const lookup = await buildLocalLookup(articleId);
      setImageLookup(() => lookup);
    });
  }, [built, articleId]);

  // Push annotations into the reader on every change.
  useEffect(() => {
    if (!annotations.data || !readerRef.current) return;
    const items = annotations.data
      .filter((a) => !renderedAnnotationIds.current.has(a.id))
      .map((a) => ({
        id: a.id,
        ranges: (JSON.parse(a.ranges_json) as SerializedRange[])[0],
      }))
      .filter((it) => it.ranges);
    if (items.length === 0) return;
    readerRef.current.post({ kind: "render-annotations", items });
    items.forEach((it) => renderedAnnotationIds.current.add(it.id));
  }, [annotations.data]);

  // Reset rendered-set when article changes.
  useEffect(() => {
    renderedAnnotationIds.current.clear();
  }, [articleId, built?.document]);

  const initialScroll = article.data?.scroll_position ?? 0;

  const onHighlight = async () => {
    if (!selection.active) return;
    const tempId = await createAnnotationAction({
      articleId,
      quote: selection.text,
      ranges: [selection.ranges],
      text: null,
    });
    readerRef.current?.post({
      kind: "wrap-selection",
      tempId,
      ranges: selection.ranges,
    });
    renderedAnnotationIds.current.add(tempId);
    setSelection({ active: false });
  };

  if (article.isLoading || !article.data) {
    return (
      <View className="flex-1 bg-bg items-center justify-center">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-bg">
      <View className="px-6 pt-12 pb-3 border-b border-border flex-row items-center justify-between">
        <Pressable accessibilityRole="button" onPress={() => router.back()}>
          <Text className="text-accent text-base">← Back</Text>
        </Pressable>
        <Text className="text-subtle text-xs flex-1 ml-3" numberOfLines={1}>
          {article.data.url}
        </Text>
      </View>
      <View className="flex-1">
        {built ? (
          <ReaderContent
            ref={readerRef}
            document={built.document}
            initialScroll={initialScroll}
            onScroll={(p) => {
              void getDb().then((db) => setScrollPosition(db, articleId, p));
            }}
            onSelection={(text, ranges) => setSelection({ active: true, text, ranges })}
            onSelectionCleared={() => setSelection({ active: false })}
            onAnnotationClick={(annoId) => {
              const found = annotations.data?.find((a) => a.id === annoId);
              if (found) {
                setOpenAnnotation({
                  id: found.id,
                  quote: found.quote,
                  text: found.text,
                });
              }
            }}
            onAnnotationCreated={() => {
              // The reader has wrapped the new mark; nothing more to do.
            }}
          />
        ) : (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator />
          </View>
        )}
      </View>
      <SelectionToolbar
        visible={selection.active && !openAnnotation && !showPrefs}
        onHighlight={onHighlight}
        onDismiss={() => setSelection({ active: false })}
      />
      <ActionBar
        articleId={articleId}
        url={article.data.url}
        title={article.data.title}
        isStarred={article.data.is_starred === 1}
        isArchived={article.data.is_archived === 1}
        onOpenPrefs={() => setShowPrefs(true)}
      />
      {showPrefs ? <ReaderPrefsSheet onClose={() => setShowPrefs(false)} /> : null}
      <AnnotationSheet
        annotation={openAnnotation}
        onClose={() => setOpenAnnotation(null)}
      />
    </View>
  );
}
```

- [ ] **Step 2: Verify** all four checks + web export.

- [ ] **Step 3: Commit**:

```
feat(reader): wire selection toolbar + annotation sheet into the reader route
```

---

## Task 9: README + Phase 4b close

**Files:** Modify `README.md`. Replace ONLY the `## Status` section to add a Phase 4b block.

- [ ] **Step 1: Update `## Status`** by adding under the existing Phase 4 block:

```markdown
Phase 4b (Annotations) complete:

- Render existing annotations as highlights on article load
- Select text → "Highlight" toolbar → tap to create a new highlight
- Tap a highlight → bottom sheet to read the quote, edit a note, or delete
- All operations optimistic via the Phase-2 outbox; offline-friendly
- XPath range serializer (single-block ranges) — heavily unit-tested
```

(Update the trailing line listing what's deferred to: `Native share targets (iOS share extension, Android intent filter) and the release pipeline arrive in later phases.`)

- [ ] **Step 2: Commit**:

```
docs: README for Phase 4b
```

---

## Self-review

**Spec coverage check (Phase 4b scope):**

| Spec section | Covered by |
|---|---|
| §8.2 Render existing annotations as `<mark>` wrappers | Tasks 3, 4, 8 |
| §8.2 Create highlight from selection | Tasks 2, 6, 8 |
| §8.2 Edit note + delete | Tasks 2, 7, 8 |
| §8.2 Range serializer (single-block) | Task 1 |
| §8.2 `Selection.getRangeAt(0)` → Wallabag range format | Task 3 (bridge) + Task 1 (serializer) |
| §8.2 Optimistic insert into `annotations` + outbox | Task 2 (uses Phase 2's `repoCreate` + outbox) |

**Out of scope by design:**
- Multi-block highlight serialization (clamps to start block instead).
- Annotation list view in Settings (defer to a polish pass).
- Highlight color customisation (single accent color).
- "Look up" / "Copy" in the selection toolbar (just Highlight).

**Placeholder scan:** No "TBD" / "TODO" / "implement later" in the plan body.

**Type consistency:**
- `SerializedRange` defined in Task 1 (`src/reader/range-serializer.ts`), re-exported in Task 5 from `ReaderContent.tsx`, consumed in Task 8.
- `AnnotationRange` (Task 2) is `Annotation["ranges"][number]` — same shape as `SerializedRange`. The two type names are aliases of the same record. Task 8 mixes them which is fine.
- Outbox payload `createAnnotation` shape `{ tempId, entryId, quote, ranges, text }` matches what Phase 2 Task 15's drainer expects (verified against `src/sync/outbox-drainer.ts` Payloads type).
- Outbox payload `updateAnnotation` shape `{ id, text }` matches drainer.
- Outbox payload `deleteAnnotation` shape `{ id }` matches drainer.
- `BridgeMessage` / `HostMessage` (Task 5) used via the imperative `ReaderContentHandle.post()` method.
