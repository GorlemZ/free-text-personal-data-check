import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/models/**",
      "**/results/**",
      "**/evidence/**",
      ".hermes/**",
      "tests/evaluation/**",
    ],
  },
  {
    files: ["tests/**/*.mjs"],
    ...eslint.configs.recommended,
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        fetch: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setImmediate: "readonly",
        AbortSignal: "readonly",
      },
    },
    rules: { "no-unused-vars": "off" },
  },
  ...tseslint.configs.strictTypeChecked.map((config) => ({
    ...config,
    files: ["poc-horizon/src/**/*.ts", "poc-bardsai/src/**/*.ts"],
  })),
  {
    files: ["poc-horizon/src/**/*.ts", "poc-bardsai/src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: false },
      ],
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/no-redundant-type-constituents": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-misused-spread": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
);
