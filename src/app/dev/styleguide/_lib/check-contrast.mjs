#!/usr/bin/env node
/**
 * WCAG AA contrast check for every text/background token pair in both themes.
 *
 *   node src/app/dev/styleguide/_lib/check-contrast.mjs          # summary, exit 1 on failure
 *   node src/app/dev/styleguide/_lib/check-contrast.mjs --md     # markdown tables (docs/DESIGN.md)
 *
 * Reads the real values from src/app/globals.css, so the report can never drift from the tokens.
 * Requires Node ≥ 22.18 (built-in TypeScript type stripping for ./contrast.ts).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { TOKEN_PAIRS, pairContrast, requiredRatio } = await import("./contrast.ts");

const css = readFileSync(resolve(here, "../../../globals.css"), "utf8");

/** @param {string} selector */
function readBlock(selector) {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`Block ${selector} not found in globals.css`);
  const end = css.indexOf("\n}", start);
  const body = css.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, "");
  /** @type {Record<string, string>} */
  const vars = {};
  for (const match of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) vars[match[1]] = match[2].trim();
  return vars;
}

const themes = { light: readBlock(":root"), dark: readBlock(".dark") };

/**
 * @param {Record<string, string>} vars
 * @param {string} token
 */
function resolveToken(vars, token) {
  if (token.startsWith("#") || token.startsWith("rgb")) return token;
  const value = vars[token];
  if (!value) throw new Error(`Unknown token --${token}`);
  return value;
}

const asMarkdown = process.argv.includes("--md");
let failures = 0;

for (const [theme, vars] of Object.entries(themes)) {
  const rows = TOKEN_PAIRS.map((pair) => {
    const fg = resolveToken(vars, pair.fg);
    const bg = resolveToken(vars, pair.bg);
    const base = resolveToken(vars, pair.base ?? "background");
    const ratio = pairContrast(fg, bg, base);
    if (ratio === null) throw new Error(`Cannot parse ${pair.fg} on ${pair.bg} (${theme})`);
    const need = requiredRatio(pair.kind);
    const pass = ratio >= need;
    if (!pass) failures += 1;
    return { pair, ratio, need, pass };
  });

  if (asMarkdown) {
    console.log(`\n#### ${theme === "light" ? "Light" : "Dark"} theme\n`);
    console.log("| Foreground | Background | Kind | Ratio | Needs | Result | Used for |");
    console.log("|---|---|---|--:|--:|:-:|---|");
    for (const { pair, ratio, need, pass } of rows) {
      const bg = pair.base ? `${pair.bg} on ${pair.base}` : pair.bg;
      console.log(
        `| \`${pair.fg}\` | \`${bg}\` | ${pair.kind} | ${ratio.toFixed(2)} | ${need} | ${pass ? "Pass" : "**FAIL**"} | ${pair.note ?? ""} |`,
      );
    }
  } else {
    const failed = rows.filter((r) => !r.pass);
    const min = Math.min(...rows.filter((r) => r.pair.kind === "text").map((r) => r.ratio));
    console.log(`${theme}: ${rows.length} pairs, ${failed.length} failing, lowest text ratio ${min.toFixed(2)}`);
    for (const { pair, ratio, need } of failed) {
      console.log(`  FAIL ${pair.fg} on ${pair.bg}${pair.base ? ` (on ${pair.base})` : ""}: ${ratio.toFixed(2)} < ${need}`);
    }
  }
}

process.exit(failures > 0 ? 1 : 0);
