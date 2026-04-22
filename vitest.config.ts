import { defineConfig } from "vitest/config";
import path from "node:path";
import fs from "node:fs";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
    // Default vitest ignores node_modules and .git, but it picks up everything
    // else under the cwd. Stale git-worktrees dropped by subagents in
    // .claude/worktrees/ contain duplicate tests with old code that we don't
    // want included in our test count.
    exclude: ["**/node_modules/**", "**/dist/**", "**/.git/**", ".claude/worktrees/**"],
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
