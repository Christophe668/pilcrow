import { defineConfig } from "vitest/config";
import path from "node:path";
import fs from "node:fs";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.d.ts", "src/test/**", "src/theme/tokens.generated.ts"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "react-native": "react-native-web",
    },
  },
  plugins: [
    {
      name: "raw-sql",
      transform(_code, id) {
        if (id.endsWith(".sql")) {
          const raw = fs.readFileSync(id, "utf8");
          return { code: `export default ${JSON.stringify(raw)};`, map: null };
        }
        return null;
      },
    },
  ],
});
