import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // Skip generated output, Deno edge functions (not part of browser tsconfig),
    // Vercel API routes, seed scripts, and Playwright config files – none of these
    // are included in the project's tsconfig and therefore cannot use
    // type-aware lint rules.
    ignores: [
      "dist",
      "supabase/functions/**",
      "api/**",
      "seeds/**",
      "playwright.config.ts",
      "playwright-fixture.ts",
    ],
  },
  {
    // Type-aware rules scoped to the browser source tree covered by tsconfig.json.
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parser: tseslint.parser,
      parserOptions: {
        project: true,
        tsconfigRootDir: process.cwd(),
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // React Hooks
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],

      // TypeScript Rules
      // Note: tsconfig.json has strict: false (no strictNullChecks), so rules
      // that require strictNullChecks are disabled here to avoid false positives.
      "@typescript-eslint/explicit-member-accessibility": [
        "warn",
        { accessibility: "explicit" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false, arguments: false } }],
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      // Requires strictNullChecks – disabled until tsconfig enables it
      "@typescript-eslint/prefer-nullish-coalescing": "off",
      "@typescript-eslint/prefer-optional-chain": "warn",
      // Requires strictNullChecks – disabled until tsconfig enables it
      "@typescript-eslint/strict-boolean-expressions": "off",

      // General Rules
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-debugger": "error",
      "no-var": "error",
      "prefer-const": "error",
      "prefer-arrow-callback": "warn",
    },
  },
  {
    // Config files at the repo root – lint without type-aware rules
    // since they may be covered by different tsconfigs (tsconfig.node.json).
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["*.config.ts", "*.config.js", "vitest.config.ts"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.node,
    },
    rules: {
      // Config files commonly use require() for plugins (e.g. Tailwind).
      "@typescript-eslint/no-require-imports": "off",
    },
  }
);
