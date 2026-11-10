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
    ".next-e2e/**",
    ".next-build/**",
    "src/generated/**",
    ".data/**",
    "test-results/**",
    "playwright-report/**",
    "public/sw.js",
    // Separate white-theme copy of the app, with its own config.
    "JOIA_white /**",
  ]),
]);

export default eslintConfig;
