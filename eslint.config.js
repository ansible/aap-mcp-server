import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import prettier from "eslint-config-prettier";

export default [
  js.configs.recommended,
  {
    ignores: [
      "assets/**/*",
      "dist/**/*",
      "node_modules/**/*",
      "tools/**/*",
      "tests/**/*",
    ],
  },
  {
    files: ["src/**/*.ts", "src/**/*.js", "scripts/**/*.ts", "scripts/**/*.js"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      // Basic TypeScript rules - only essential ones for now
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "off", // Allow any for now in existing codebase
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",

      // General JavaScript/TypeScript rules - most important ones
      "no-console": "off", // Allow console.log for server logging
      "no-unused-vars": "off", // Use TypeScript version instead
      "no-undef": "off", // TypeScript handles this
      "prefer-const": "warn",
      "no-var": "error",
      eqeqeq: "warn",
      curly: "off", // Disable for now due to existing code style

      // Style rules - disable for now to avoid massive changes
      indent: "off",
      quotes: "off",
      semi: "off",
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.js"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off", // Allow any in tests
    },
  },
  prettier, // Disable ESLint rules that conflict with Prettier
];
