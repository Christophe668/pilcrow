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

  if (endBlock) {
    const endPath = endBlock === startBlock ? startPath : elementPathFromRoot(endBlock, root);
    if (endPath) {
      const endOffset =
        range.endContainer.nodeType === Node.TEXT_NODE
          ? elementOffsetFor(endBlock, range.endContainer as Text, range.endOffset)
          : elementTextLength(endBlock);
      return { start: startPath, startOffset, end: endPath, endOffset };
    }
  }

  // End block missing or unpathable — clamp to the start block so the
  // highlight degrades to a prefix instead of being dropped entirely.
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

/**
 * Source string of the serializer suitable for injection into a WebView/iframe.
 * Mirrors the exported functions but as a self-contained IIFE.
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
    if (endBlock) {
      var endPath = endBlock === startBlock ? startPath : elementPathFromRoot(endBlock, root);
      if (endPath) {
        var endOffset = range.endContainer.nodeType === 3
          ? elementOffsetFor(endBlock, range.endContainer, range.endOffset)
          : elementTextLength(endBlock);
        return { start: startPath, startOffset: startOffset, end: endPath, endOffset: endOffset };
      }
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
