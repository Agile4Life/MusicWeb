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
    "scratch/**",
    "test_*.js",
    "clean_*.js",
    "public/**",
    ".agents/**",
    "scripts/**",
    "worker/**",
    "workers/**",
    "sc-api-auth.mjs",
    "test_smtp.js",
    "graphify-out/**",
  ]),
]);

export default eslintConfig;
