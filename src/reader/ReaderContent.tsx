import { Linking, Platform } from "react-native";
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
  | { kind: "link-click"; url: string }
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
  /** Bridge has registered its listeners; safe to post host messages. */
  onReady?: () => void;
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
    if (kind === "link-click" && typeof o["url"] === "string") {
      return { kind: "link-click", url: o["url"] };
    }
    if (kind === "annotation:click" && typeof o["id"] === "number") {
      return { kind: "annotation:click", id: o["id"] };
    }
    if (kind === "annotation:created" && typeof o["tempId"] === "number") {
      return { kind: "annotation:created", tempId: o["tempId"], success: !!o["success"] };
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

function openExternally(url: string) {
  if (Platform.OS === "web") {
    // _blank + noopener so the linked page can't reach back into the
    // reader window, and rel='noreferrer' keeps the source URL private.
    if (typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
    return;
  }
  void Linking.openURL(url).catch(() => undefined);
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
    case "link-click":
      // Anchor clicks always open externally — the in-iframe iframe is
      // sandboxed (no top-navigation) and the native WebView would
      // otherwise replace the article body with the linked page. Either
      // way, the user wants the system browser.
      openExternally(msg.url);
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
      props.onReady?.();
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
        // Only accept messages from our iframe. Can't check e.origin — the
        // sandboxed srcdoc frame has an opaque origin ("null"), which any
        // other sandboxed frame would share — so compare the window itself.
        if (!innerRef.current?.contentWindow || e.source !== innerRef.current.contentWindow) {
          return;
        }
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
        // No allow-same-origin: the article HTML is third-party content, and
        // pairing it with allow-scripts would hand its scripts the app's
        // origin (localStorage holds the access token). The opaque origin
        // still allows postMessage both ways with targetOrigin "*".
        sandbox="allow-scripts"
        style={{ flex: 1, border: 0, width: "100%", height: "100%" } as React.CSSProperties}
      />
    );
  },
);

const ReaderContentNative = forwardRef<ReaderContentHandle, ReaderContentProps>(
  function ReaderContentNative(props, ref) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { WebView } = require("react-native-webview") as typeof import("react-native-webview");
    const innerRef = useRef<InstanceType<
      (typeof import("react-native-webview"))["WebView"]
    > | null>(null);

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
        // Belt and suspenders: the bridge intercepts anchor clicks via JS,
        // but if anything slips through (e.g. JS-driven location changes,
        // form posts), don't let the WebView navigate away from the
        // article. Open it externally instead.
        onShouldStartLoadWithRequest={(req) => {
          // The initial load is `about:blank` (RN's html-source default)
          // — let that through. Any other navigation we redirect.
          if (req.url === "about:blank" || req.url.startsWith("data:")) return true;
          openExternally(req.url);
          return false;
        }}
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
