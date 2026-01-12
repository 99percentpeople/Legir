import eslint from "@eslint/js";

export default [
  eslint.configs.recommended,
  {
    // Custom configurations apply to default JS files
    rules: {
      semi: "error",
      "prefer-const": "error",
      "no-unused-vars": "warn",
    },
  },
  {
    // Ignores specific files
    ignores: ["dist/", "node_modules/"],
  },
];
