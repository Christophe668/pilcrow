export type SerializedRange = {
  start: string;
  startOffset: number;
  end: string;
  endOffset: number;
};

function elementPathFromRoot(node: Node, root: Node): string | null {
  const parts: string[] = [];
  let n: Node | null = node;
  while (n && n !== root) {
    if (n.nodeType === Node.ELEMENT_NODE) {
      const el = n as Element;
      const tag = el.tagName.toLowerCase();
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

function elementOffsetFor(block: Element, targetTextNode: Text, targetOffset: number): number {
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

function startBlockElement(node: Node, root: Node): Element | null {
  let el: Node | null = node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode;
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

  let startOffset: number;
  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    startOffset = elementOffsetFor(startBlock, range.startContainer as Text, range.startOffset);
  } else {
    startOffset = 0;
  }

  if (endBlock && startBlock === endBlock) {
    let endOffset: number;
    if (range.endContainer.nodeType === Node.TEXT_NODE) {
      endOffset = elementOffsetFor(startBlock, range.endContainer as Text, range.endOffset);
    } else {
      endOffset = elementTextLength(startBlock);
    }
    return { start: startPath, startOffset, end: startPath, endOffset };
  }

  return {
    start: startPath,
    startOffset,
    end: startPath,
    endOffset: elementTextLength(startBlock),
  };
}

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

export function deserializeRange(ser: SerializedRange, root: Element): Range | null {
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
