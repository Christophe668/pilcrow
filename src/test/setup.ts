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

const { cleanup } = await import("@testing-library/react-native");
const { server } = await import("./msw-server");

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  cleanup();
});
afterAll(() => server.close());
