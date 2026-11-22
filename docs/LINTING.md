# Linting

**Oxlint** (Rust, from the Oxc project) is the main linter (roadmap B-11, decision D9). ESLint stays
installed only for the few rules Oxlint does not have.

| Command | What it runs | Time (4 CPUs, 391 files) |
|---|---|---|
| `npm run lint` | `oxlint --deny-warnings` with `.oxlintrc.json` (88 rules). Any warning fails, like ESLint's "0 problems" bar before. | **0.4 s** |
| `npm run lint:eslint` | ESLint with `eslint.config.mjs`; `eslint-plugin-oxlint` turns off every rule Oxlint already checks, so only the 7 rules below run | 12 s |
| before B-11: `eslint` (86 rules) | | 14 s |

ESLint's time is almost all file parsing, so running it for 7 rules saves little. CI and every
pre-push check run `npm run lint`; `lint:eslint` is optional.

## Rule coverage

`.oxlintrc.json` was generated from the ESLint config (`eslint-config-next` core-web-vitals +
typescript) with `@oxlint/migrate@1.90.0`, then extended. **79 of ESLint's 86 active rules** carry
over, including all 14 React Compiler rules of `eslint-plugin-react-hooks` (`rules-of-hooks`,
`exhaustive-deps`, `purity`, `refs`, `set-state-in-effect`, `immutability`, …; Oxlint names them
`react/…`, and `eslint-disable` comments with `react-hooks/…` names still work).

The 7 rules Oxlint does not run, and why that is acceptable:

| ESLint rule | Why it does not matter here |
|---|---|
| `react/jsx-uses-react` | Not needed with the React 17+ JSX transform |
| `react/jsx-uses-vars` | `no-unused-vars` already counts JSX usage |
| `react/no-deprecated` | The APIs it flags were removed in React 19, so TypeScript fails on them |
| `react/require-render-return` | Class components only; the codebase has none (still "nursery" in Oxlint) |
| `react-hooks/config`, `react-hooks/gating` | Validate React Compiler options; we do not configure the compiler |
| `@next/next/no-location-assign-relative-destination` | Minor; `npm run lint:eslint` still checks it |

Added beyond ESLint:
- **Vitest plugin** for `src/**/*.test.ts`: `valid-expect` (allows Vitest's `expect(value, message)`),
  `no-identical-title`, `no-focused-tests`, `expect-expect`, `valid-describe-callback`,
  `no-conditional-tests`, `no-import-node-test`, `no-disabled-tests` (warning).
- Ignored: `.next/`, `backend/` (Rust, linted by clippy), the generated
  `src/lib/supabase/database.types.ts`, test and coverage output.

Differences found on the first run, and what was done:
- `react/purity` flagged `new Date()` in four async **Server Components** (`page.tsx`). They render
  once on the server, so it is turned off for `src/app/**/page.tsx` and `layout.tsx` (no page or
  layout is a Client Component today; if one becomes one, move it out of that pattern or re-enable
  the rule for it).
- `react/purity` in `notification-bell.tsx` (`now ?? new Date()`): intentional, so relative times
  refresh; kept with a disable comment that says why.
- `prefer-const` in `calendar.test.ts`: a real finding ESLint missed; fixed.

## Vitest isolation (measured, not adopted)

`vitest run --no-isolate` is green (also with three shuffled orders) and cuts the suite from 3.4 s to
0.7 s. It is **not** turned on: several test files set `process.env` directly without restoring
it, so without isolation a future test could pass or fail depending on file order. Saving ≈ 2.7 s
is not worth that.

## Editor

Install the "Oxc" VS Code extension (`oxc.oxc-vscode`); it reads `.oxlintrc.json`. The ESLint
extension can stay off.
