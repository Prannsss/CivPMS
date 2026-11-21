import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import oxlint from "eslint-plugin-oxlint";

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
    // Agent worktrees (git-ignored) contain their own .next builds and sources.
    ".claude/**",
    "backend/**",
  ]),
  // Oxlint (`npm run lint`) is the main linter. This config only runs the few rules Oxlint lacks
  // (`npm run lint:eslint`, see docs/LINTING.md): every rule Oxlint already checks is turned off.
  ...oxlint.buildFromOxlintConfigFile("./.oxlintrc.json"),
  // Disable comments name rules that are now off here but on in Oxlint; don't report them as unused.
  { linterOptions: { reportUnusedDisableDirectives: "off" } },
]);

export default eslintConfig;
