import js from "@eslint/js";
import tseslint from "typescript-eslint";
import expoConfig from "eslint-config-expo/flat.js";
import prettier from "eslint-plugin-prettier/recommended";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...expoConfig,
  prettier,
  {
    ignores: [
      "node_modules/",
      "ios/",
      "android/",
      ".expo/",
      ".claude/",
      "dist/",
      "tests/coverage/",
    ],
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  // Metro/Babel configs and transformers are CommonJS by Expo convention.
  {
    files: [
      "metro.config.js",
      "babel.config.js",
      "scripts/sql-transformer.js",
      "scripts/dev-backend-proxy.js",
    ],
    languageOptions: { globals: { Buffer: "readonly", require: "readonly", module: "readonly" } },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Tailwind config uses `require()` for the NativeWind preset.
  {
    files: ["tailwind.config.ts"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Font loader uses `require()` for `.ttf` assets (Metro asset resolution).
  {
    files: ["src/theme/fonts.ts"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // The recommended `tseslint.configs.X` access pattern is flagged as
  // `import/no-named-as-default-member`; silence it on this config file.
  {
    files: ["eslint.config.mjs"],
    rules: {
      "import/no-named-as-default-member": "off",
    },
  },
);
