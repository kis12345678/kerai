import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The Android app is a separate Gradle/Kotlin project with no JS/TS at all.
    "android/**",
  ]),
  // The Electron shell is a separate mini-project written in plain CommonJS — `require` is
  // correct there, and it's not a Next.js app, so the next-specific rules don't apply.
  {
    files: ["desktop/**/*.js"],
    languageOptions: {
      globals: {
        // Electron main/preload processes (require itself is allowed by the rule override).
        __dirname: "readonly",
        process: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        console: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@next/next/no-assign-module-variable": "off",
    },
  },
]);

export default eslintConfig;
