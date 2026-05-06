import { RANGE_SERIALIZER_SOURCE } from "./range-serializer";

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
