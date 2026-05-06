import { Platform } from "react-native";
import { useEffect, useRef } from "react";

export type ReaderContentProps = {
  /** Complete HTML document with bridge JS injected. */
  document: string;
  /** Initial scroll position (0..1) to restore once bridge reports ready. */
  initialScroll?: number;
  /** Called when the bridge reports a new scroll position (0..1, debounced). */
  onScroll?: (position: number) => void;
};

type BridgeMessage = { kind: "scroll"; position: number } | { kind: "ready" };

function parseMsg(raw: unknown): BridgeMessage | null {
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!obj || typeof obj !== "object") return null;
    const kind = (obj as { kind?: unknown }).kind;
    if (kind === "scroll" && typeof (obj as { position?: unknown }).position === "number") {
      return { kind: "scroll", position: (obj as { position: number }).position };
    }
    if (kind === "ready") return { kind: "ready" };
    return null;
  } catch {
    return null;
  }
}

function ReaderContentWeb(props: ReaderContentProps) {
  const ref = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const msg = parseMsg(e.data);
      if (!msg) return;
      if (msg.kind === "scroll" && props.onScroll) {
        props.onScroll(msg.position);
      }
      if (
        msg.kind === "ready" &&
        typeof props.initialScroll === "number" &&
        ref.current?.contentWindow
      ) {
        ref.current.contentWindow.postMessage(
          { kind: "restore-scroll", position: props.initialScroll },
          "*",
        );
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [props]);

  return (
    <iframe
      ref={ref}
      title="Reader"
      srcDoc={props.document}
      sandbox="allow-same-origin allow-scripts"
      style={{ flex: 1, border: 0, width: "100%", height: "100%" } as React.CSSProperties}
    />
  );
}

function ReaderContentNative(props: ReaderContentProps) {
  // Lazy require to keep the web bundle from including react-native-webview.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { WebView } = require("react-native-webview") as typeof import("react-native-webview");
  const ref = useRef<InstanceType<(typeof import("react-native-webview"))["WebView"]> | null>(null);

  return (
    <WebView
      ref={ref}
      originWhitelist={["*"]}
      source={{ html: props.document }}
      style={{ flex: 1, backgroundColor: "transparent" }}
      javaScriptEnabled
      domStorageEnabled={false}
      onMessage={(e) => {
        const msg = parseMsg(e.nativeEvent.data);
        if (!msg) return;
        if (msg.kind === "scroll" && props.onScroll) {
          props.onScroll(msg.position);
        }
        if (msg.kind === "ready" && typeof props.initialScroll === "number") {
          ref.current?.injectJavaScript(
            `(function(){window.dispatchEvent(new MessageEvent('message',{data:'${JSON.stringify({
              kind: "restore-scroll",
              position: props.initialScroll,
            }).replace(/'/g, "\\'")}'}))})();true;`,
          );
        }
      }}
    />
  );
}

export function ReaderContent(props: ReaderContentProps) {
  if (Platform.OS === "web") return <ReaderContentWeb {...props} />;
  return <ReaderContentNative {...props} />;
}
