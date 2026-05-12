import { afterAll, afterEach, beforeAll, vi } from "vitest";

// Vitest's `resolve.alias` rewrites Vite-transformed `import` statements,
// but several `react-native`-derived deps (e.g. `@testing-library/react-native`,
// `nativewind` -> `react-native-css-interop`) ship CJS that calls
// `require("react-native")` at runtime through Node's loader. Node then tries
// to parse RN's Flow-typed `index.js` (`import typeof ...`) and fails.
//
// Patch Node's CJS resolver before any test deps load so all
// `require("react-native")` calls return `react-native-web` instead. The
// patch runs synchronously inside `vi.hoisted` so it lands before the dynamic
// imports below.
vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Module = require("node:module") as typeof import("node:module");
  const proto = (Module as unknown as { prototype: { require: (id: string) => unknown } })
    .prototype;
  const orig = proto.require;
  proto.require = function patched(this: unknown, ...args: [string]) {
    const [id] = args;
    if (id === "react-native") {
      return orig.call(this, "react-native-web");
    }
    return orig.apply(this, args);
  };
});

vi.mock("nativewind", () => ({ vars: (obj: unknown) => obj }));

// Tests exercise the native (SecureStore) code path of `src/auth/storage.ts`.
// On real web `Platform.OS === "web"` makes the wrapper read/write
// `localStorage`; under Vitest we mock `expo-secure-store` directly, so we
// also need `Platform.OS` to NOT be "web" for the SecureStore branch to run.
vi.mock("react-native", async () => {
  const actual = await vi.importActual<typeof import("react-native")>("react-native");
  return {
    ...actual,
    Platform: { ...actual.Platform, OS: "ios" },
  };
});

// `react-native-web` translates RN host components into plain DOM elements
// (`View` -> `div`, `Text` -> `div`, `TextInput` -> `input`, `Pressable` -> `button`).
// `@testing-library/react-native`'s default host-component detection only
// recognizes the RN names ("Text", "TextInput", etc.), so RNTL queries return
// nothing on our jsdom-rendered tree. Patch the helper module so the queries
// detect the rn-web DOM equivalents instead.
//
// We distinguish `View` and `Text` (both render to `div`) by their classNames:
// rn-web emits `css-text-…` for Text and `css-view-…` / `css-textinput-…`
// for the others.
{
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const hostNames = require("@testing-library/react-native/build/helpers/host-component-names") as {
    isHostText: (e: unknown) => boolean;
    isHostTextInput: (e: unknown) => boolean;
    isHostImage: (e: unknown) => boolean;
    isHostSwitch: (e: unknown) => boolean;
    isHostScrollView: (e: unknown) => boolean;
    isHostModal: (e: unknown) => boolean;
  };
  const asNode = (e: unknown) =>
    e as { type?: unknown; props?: { className?: unknown } } | null | undefined;
  const cls = (e: unknown) => {
    const c = asNode(e)?.props?.className;
    return typeof c === "string" ? c : "";
  };
  hostNames.isHostText = (e: unknown) => {
    const n = asNode(e);
    return typeof n?.type === "string" && n.type === "div" && /\bcss-text-/.test(cls(e));
  };
  hostNames.isHostTextInput = (e: unknown) => {
    const n = asNode(e);
    return (
      typeof n?.type === "string" &&
      (n.type === "input" || n.type === "textarea") &&
      /\bcss-textinput-/.test(cls(e))
    );
  };
  hostNames.isHostImage = (e: unknown) => {
    const n = asNode(e);
    return typeof n?.type === "string" && (n.type === "img" || n.type === "picture");
  };

  // `isAccessibilityElement` short-circuits on `props.accessible`, but rn-web
  // doesn't set that prop. Treat any element with an explicit ARIA `role` (or
  // RN `accessibilityRole`) as accessible so `getByRole` queries match.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const accessibility = require("@testing-library/react-native/build/helpers/accessibility") as {
    isAccessibilityElement: (e: unknown) => boolean;
  };
  const origIsAccessible = accessibility.isAccessibilityElement;
  accessibility.isAccessibilityElement = (e: unknown) => {
    const el = e as { props?: { role?: unknown; accessibilityRole?: unknown } } | null;
    if (el?.props?.role || el?.props?.accessibilityRole) return true;
    return origIsAccessible(e);
  };
}

const { cleanup } = await import("@testing-library/react-native");
const { server } = await import("./msw-server");

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  cleanup();
});
afterAll(() => server.close());
