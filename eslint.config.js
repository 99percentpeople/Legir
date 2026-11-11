import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Surface new ESLint 10 diagnostics without changing the existing lint gate.
    rules: {
      "no-useless-assignment": "warn",
      "preserve-caught-error": "warn",
    },
  },
  {
    files: [
      "src/**/*.{js,jsx,ts,tsx}",
      "www/**/*.{js,jsx,ts,tsx}",
      "packages/*/src/**/*.{js,ts}",
    ],
    rules: {
      semi: "error",
      "prefer-const": "error",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    files: [
      "scripts/check-module-boundaries.mjs",
      "scripts/check-package-consumer.mjs",
      "scripts/pdf-consumer-smoke.mjs",
      "scripts/publish-npm-libraries.mjs",
    ],
    languageOptions: {
      globals: {
        AbortSignal: "readonly",
        console: "readonly",
        fetch: "readonly",
        process: "readonly",
      },
    },
  },
  {
    // Ignores specific files
    ignores: [
      "**/dist/**",
      "**/dev-dist/**",
      "**/node_modules/**",
      "**/.cache/**",
      "packages/pdfium/wasm/**",
      "src-tauri/**",
    ],
  },
);
