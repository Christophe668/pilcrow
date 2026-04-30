import { ANNOTATIONS_BRIDGE_JS } from "./annotations-bridge";

/**
 * The bridge runs inside the article HTML. It posts these message kinds:
 *  - { kind: "scroll", position: 0..1 }  (debounced)
 *  - { kind: "ready" }                    (after first paint)
 *  - { kind: "link-click", url: string }  (anchor click; host opens externally)
 *
 * It also listens for messages from the host:
 *  - { kind: "restore-scroll", position: 0..1 }
 *
 * On native, `window.ReactNativeWebView.postMessage(JSON)` is the channel.
 * On web (iframe), `window.parent.postMessage(obj, "*")` is the channel and
 * we listen on `window.message`.
 */
export const READER_BRIDGE_JS = `(function () {
  var isNative = typeof window.ReactNativeWebView !== 'undefined';
  function send(msg) {
    var json = JSON.stringify(msg);
    if (isNative) {
      window.ReactNativeWebView.postMessage(json);
    } else if (window.parent && window.parent !== window) {
      window.parent.postMessage(msg, '*');
    }
  }

  var lastScroll = 0;
  var scrollTimer = null;
  function updateProgressVar(pos) {
    // Drives the --read-progress CSS var that the column-rule accent uses
    // for its height. Updated on every scroll tick (cheap — single style op),
    // not on the debounced report.
    document.documentElement.style.setProperty(
      '--read-progress',
      (Math.round(pos * 1000) / 10) + '%'
    );
  }
  function reportScroll() {
    var doc = document.documentElement;
    var max = (doc.scrollHeight - window.innerHeight);
    var pos = max > 0 ? Math.max(0, Math.min(1, window.scrollY / max)) : 0;
    if (Math.abs(pos - lastScroll) > 0.005) {
      lastScroll = pos;
      send({ kind: 'scroll', position: pos });
    }
  }
  window.addEventListener('scroll', function () {
    var doc = document.documentElement;
    var max = (doc.scrollHeight - window.innerHeight);
    var pos = max > 0 ? Math.max(0, Math.min(1, window.scrollY / max)) : 0;
    updateProgressVar(pos);
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(reportScroll, 250);
  });
  // Initial paint: progress at 0 unless a scroll restoration happens shortly.
  updateProgressVar(0);

  // Intercept anchor clicks so links don't navigate inside the iframe /
  // WebView. Internal #hash anchors fall through (browser handles scroll).
  // Everything else is forwarded to the host, which calls Linking.openURL
  // (native) or window.open (web). The bridge resolves relative URLs via
  // anchor.href, which uses the document's <base href> we inject when
  // building the article HTML.
  document.addEventListener('click', function (e) {
    var node = e.target;
    while (node && node !== document.body && node.nodeType === 1) {
      if (node.tagName === 'A') {
        var href = node.getAttribute('href');
        if (!href) return;
        if (href.charAt(0) === '#') return; // let the browser scroll
        e.preventDefault();
        e.stopPropagation();
        var resolved = node.href || href;
        send({ kind: 'link-click', url: resolved });
        return;
      }
      node = node.parentNode;
    }
  }, true);

  function handleHostMessage(data) {
    if (!data || typeof data !== 'object') return;
    if (data.kind === 'restore-scroll' && typeof data.position === 'number') {
      var doc = document.documentElement;
      var max = (doc.scrollHeight - window.innerHeight);
      window.scrollTo(0, max * Math.max(0, Math.min(1, data.position)));
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
    window.addEventListener('message', function (e) {
      handleHostMessage(e.data);
    });
  }

  send({ kind: 'ready' });
})();`;

export const READER_BRIDGE_FULL_JS = `${READER_BRIDGE_JS}\n${ANNOTATIONS_BRIDGE_JS}`;
