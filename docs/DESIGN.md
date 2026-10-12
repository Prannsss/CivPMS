# CivPMS design system

The visual language, tokens and component catalog for CivPMS. Binding together with `CLAUDE.md`
(design rules) and `docs/DECISIONS.md` (D4, D5, D30–D34).

- **Live showcase:** [`/dev/styleguide`](../src/app/dev/styleguide/page.tsx) (development only; it returns 404 in production).
- **Tokens:** [`src/app/globals.css`](../src/app/globals.css). **Primitives:** `src/components/ui` (import from `@/components/ui`).
  **Shell:** `src/components/shell` (import from `@/components/shell`).
- **Contrast check:** `node src/app/dev/styleguide/_lib/check-contrast.mjs` (add `--md` for the tables below). It reads
  `globals.css` directly and exits 1 if any pair fails, so run it after every token change.
- **E2E smoke tests:** `npm run test:e2e` (`e2e/styleguide.spec.ts`).

![Styleguide, light](screenshots/styleguide-light.png)

| Dark | Phone (390 px) |
|---|---|
| ![Styleguide, dark](screenshots/styleguide-dark.png) | ![Styleguide, mobile](screenshots/styleguide-mobile.png) |

Overlays: [command palette](screenshots/styleguide-palette-light.png) ·
[modal, dark](screenshots/styleguide-modal-dark.png) · [snackbars](screenshots/styleguide-toasts-light.png) ·
[type-to-confirm](screenshots/styleguide-confirm-light.png) · [mobile project navigation](screenshots/styleguide-mobile-nav.png).

---

## 1. Principles

1. **Answer "what needs attention?" first.** Status, delays and budget warnings are the loudest thing on a
   screen. Decoration stays quiet: neutral surfaces, one brand blue, generous whitespace.
2. **One obvious primary action per screen.** One solid blue button. Everything else is outline, ghost or link.
3. **Color never works alone.** Every status is color + icon + label. Delayed is a red *chip*, never a solid red
   button, so it can't be mistaken for a destructive action.
4. **Red means danger.** Red (and the yellow/orange warning tones) is reserved for destructive actions, errors,
   Delayed and budget states. Project cards use a palette without red, orange or yellow (D30).
5. **Calm in both themes.** Light is white with slate neutrals. Dark is true black with zinc surfaces. The brand
   blue fills buttons in both. Blue *text* switches to `#4C8DFF` in dark mode (D5).
6. **Accessible by default.** WCAG 2.1 AA for every token pair (checked by script), a visible focus ring
   everywhere, 44 px touch targets on phones, full keyboard support, and `prefers-reduced-motion` respected.
7. **No layout shift.** Skeletons match the final layout. Buttons keep their label while loading.
8. **Plain language.** Errors say what's wrong and how to fix it. Confirmations state the impact. Reversible
   actions offer **Undo** instead of asking first.

## 2. Tokens

All colors are CSS variables on `:root` (light) and `.dark`, exposed to Tailwind through `@theme inline`.
**Never hard-code hex values in components.** Use the utilities (`bg-surface`, `text-muted-foreground`,
`border-border-strong`, `bg-danger-soft`, `ring-ring`, …).

### 2.1 Color

| Token (utility suffix) | Light | Dark | Use |
|---|---|---|---|
| `background` | `#FFFFFF` | `#000000` | page |
| `foreground` | `#0A0A0A` | `#FAFAFA` | primary text |
| `muted-foreground` | `#475569` | `#A1A1AA` | secondary text, hints, placeholders |
| `surface` | `#FFFFFF` | `#0B0B0C` | cards, popovers, dialogs |
| `surface-muted` | `#F8FAFC` | `#111113` | panels, zebra stripes, dialog footers |
| `surface-sunken` | `#F1F5F9` | `#18181B` | input-like fills, tracks, pill search |
| `border` / `border-strong` | `#E2E8F0` / `#CBD5E1` | `#27272A` / `#3F3F46` | dividers / outline buttons, swatches |
| `input` | `#848EA0` | `#63636D` | form-control borders (≥ 3:1, WCAG 1.4.11) |
| `primary` · `-hover` · `-active` | `#0866FF` · `#0757E0` · `#0549BF` | same | filled buttons, checked controls, progress |
| `primary-foreground` | `#FFFFFF` | `#FFFFFF` | text on `primary` |
| `primary-text` | `#0656D6` | `#4C8DFF` | links and blue text |
| `primary-soft` | `#E7F0FF` | `rgba(8,102,255,.18)` | selected rows, tinted chips, active menu items |
| `danger` · `-hover` · `-foreground` | `#DC2626` · `#B91C1C` · white | same | destructive buttons, solid Delayed |
| `danger-soft` / `danger-text` | `#FEE2E2` / `#B91C1C` | `rgba(239,68,68,.16)` / `#F87171` | errors, Delayed, Budget Exceeded |
| `warning` / `-soft` / `-text` / `-foreground` | `#F59E0B` / `#FEF3C7` / `#92400E` / `#0A0A0A` | `#FBBF24` / `rgba(245,158,11,.16)` / `#FCD34D` / `#0A0A0A` | Near budget limit, soft warnings |
| `orange` / `-soft` / `-text` / `-foreground` | `#EA580C` / `#FFEDD5` / `#9A3412` / `#0A0A0A` | `#FB923C` / `rgba(249,115,22,.16)` / `#FDBA74` / `#0A0A0A` | On-Hold, escalations |
| `success` / `-soft` / `-text` / `-foreground` | `#16A34A` / `#DCFCE7` / `#166534` / `#0A0A0A` | `#22C55E` / `rgba(34,197,94,.16)` / `#4ADE80` / `#0A0A0A` | Completed |
| `info` / `-soft` / `-text` / `-foreground` | `#0EA5E9` / `#E0F2FE` / `#075985` / `#0A0A0A` | `#38BDF8` / `rgba(56,189,248,.16)` / `#7DD3FC` / `#0A0A0A` | Ongoing |
| `neutral` / `-soft` / `-text` / `-foreground` | `#64748B` / `#F1F5F9` / `#334155` / white | `#71717A` / `rgba(161,161,170,.16)` / `#D4D4D8` / white | Not Started, Planning, Cancelled |
| `sidebar-bg` / `-fg` / `-muted` / `-hover` | `#0866FF` / white / `#CFE0FF` / `#0757E0` | `#0B0B0C` / `#E4E4E7` / `#A1A1AA` / `#1C1C20` | project sidebar (D33) |
| `sidebar-active-bg` / `-active-fg` / `-border` | white / `#0A0A0A` / `rgba(255,255,255,.2)` | `#0866FF` / white / `#27272A` | active nav pill |
| `inverse` / `inverse-foreground` | `#18181B` / `#FAFAFA` | `#27272A` / `#FAFAFA` | tooltips |
| `ring` | `#0866FF` | `#4C8DFF` | focus ring |
| `overlay` | `rgba(2,6,23,.52)` | `rgba(0,0,0,.72)` | modal/sheet backdrop |
| `project-{blue,green,pink,purple,teal,graphite}` (+ `-to`) | see §2.2 | same | project cards and avatars |

**Deviations from the CLAUDE.md token table (on purpose, to pass AA):**

- `primary-text` in light is `#0656D6`, not `#0866FF`. `#0866FF` is 4.82:1 on white but only 4.2:1 on
  `primary-soft`, which is where blue text sits in selected rows and Active badges.
- `danger` stays `#DC2626` in dark mode (instead of `#EF4444`). White on `#EF4444` is 3.76:1 and fails for button
  labels. Red *text* in dark mode uses `danger-text` `#F87171` (6.7:1 on black).
- Solid warning, orange, success and info fills use near-black text (`*-foreground: #0A0A0A`). White on those
  hues fails AA.
- `input` (new) gives form controls a 3:1 border. `border-strong` alone is only about 1.5:1.

### 2.2 Project card palette

`PROJECT_COLOR_KEYS` from `src/lib/constants.ts` maps to a top and bottom gradient stop. White text passes AA on
**both** stops, so titles stay readable wherever they wrap. Cards also get a soft bottom scrim. Use
`getProjectColor(key).gradient | .solid | .ring` from `@/components/ui`. Never build the class names by string
concatenation, because Tailwind can't see them.

| Key | Top (`project-*`) | Bottom (`project-*-to`) | White text |
|---|---|---|---|
| blue | `#0866FF` | `#0447B8` | 4.82 / 8.08 |
| green | `#0F7B55` | `#095C3F` | 5.27 / 8.03 |
| pink | `#C8238A` | `#951766` | 5.17 / 8.10 |
| purple | `#7C3AED` | `#5B21B6` | 5.70 / 8.98 |
| teal | `#0E7C86` | `#0A5B63` | 4.95 / 7.81 |
| graphite | `#3F4654` | `#23272F` | 9.48 / 14.97 |

### 2.3 Typography

Poppins 400/500/600/700 via `next/font/google` (`--font-poppins`, Tailwind `font-sans`). Body text stays at
14 px because Poppins runs wide.

| Utility | Size / line height | Weight | Tracking | Use |
|---|---|---|---|---|
| `text-display` | 36/44 (30/38 below 640 px) | 600 | −0.02em | marketing and auth hero |
| `text-h1` | 28/36 (24/32 below 640 px) | 600 | −0.02em | page title (one per page) |
| `text-h2` | 22/30 | 600 | −0.015em | page sections |
| `text-h3` | 18/26 | 600 | −0.01em | card titles, dialog titles |
| `text-body-lg` | 15/24 | 400 | | lead paragraphs |
| `text-body` | 14/22 | 400 | | default |
| `text-label` | 13/20 | 500 | | form labels, sub-section titles |
| `text-caption` | 12/16 | 400 | | meta, timestamps, hints |

Use `tabular-nums` for money, dates and percentages. Format money as `₱1,234,567.89` with `formatPeso()` and
`₱8.2M` with `formatPesoCompact()`. Format dates as `10 Oct 2026`, in Asia/Manila.

> **tailwind-merge caveat.** `cn()` (tailwind-merge) treats `text-h1`, `text-body`, … as text *colors*, so
> `cn("text-h2", "text-foreground")` silently drops `text-h2`. Put typography utilities in a plain `className`
> string, or in a different `cn()` argument than any `text-<color>`. (Fix later: register them as font sizes with
> `extendTailwindMerge` in `src/lib/utils.ts`.)

### 2.4 Radius, elevation, motion, focus

- **Radius:** `rounded-xs` 6 · `rounded-sm` 8 · `rounded-md` 12 (inputs, buttons) · `rounded-lg` 16 (cards) ·
  `rounded-xl` 20 (dialogs, project cards) · `rounded-2xl` 24 · `rounded-full` (pills, icon buttons, search).
- **Shadows:** `shadow-xs` and `shadow-sm` for resting controls and cards. `shadow-md` for raised cards and the
  sidebar. `shadow-lg` for dialogs and sheets. `shadow-popover` for menus, popovers and toasts. Dark-mode shadows
  add a 1 px white hairline so elevation stays visible on black.
- **Motion:** 150–200 ms ease-out (`--ease-out`). Animations: `animate-fade-in/out`, `animate-pop-in/out`,
  `animate-sheet-in/out-{top,right,bottom,left}`, `animate-shimmer`, `animate-indeterminate`. All motion is
  cut to ~0 under `prefers-reduced-motion`.
- **Focus:** `focus-ring` (2 px `ring` outline, 2 px offset) and `focus-ring-inset` for clipped containers.
  Every interactive element has a visible focus style. Form controls use a 3 px soft ring plus a blue border.
- **Spacing:** 4 px grid. Page gutters are 16 px on phones and 24–32 px on desktop. Card padding is 20–24 px.
  Touch targets are at least 44 px below `sm` (buttons, icon buttons and inputs grow automatically).

## 3. Contrast results (WCAG 2.1 AA)

Generated by `node src/app/dev/styleguide/_lib/check-contrast.mjs --md`. "text" needs 4.5:1. "ui" (borders,
focus ring, icons, checked controls) needs 3:1. Translucent fills are composited on the surface they sit on.
**All 146 pairs pass** (73 per theme). Lowest text ratio: 4.76 light, 4.82 dark. Snackbars always render in the
dark token scope, so the dark table covers them in both themes.

<!-- contrast:start (generated: node src/app/dev/styleguide/_lib/check-contrast.mjs --md) -->

#### Light theme

| Foreground | Background | Kind | Ratio | Needs | Result | Used for |
|---|---|---|--:|--:|:-:|---|
| `foreground` | `background` | text | 19.80 | 4.5 | Pass |  |
| `foreground` | `surface` | text | 19.80 | 4.5 | Pass |  |
| `foreground` | `surface-muted` | text | 18.92 | 4.5 | Pass |  |
| `foreground` | `surface-sunken` | text | 18.07 | 4.5 | Pass |  |
| `muted-foreground` | `background` | text | 7.58 | 4.5 | Pass |  |
| `muted-foreground` | `surface` | text | 7.58 | 4.5 | Pass |  |
| `muted-foreground` | `surface-muted` | text | 7.24 | 4.5 | Pass |  |
| `muted-foreground` | `surface-sunken` | text | 6.92 | 4.5 | Pass |  |
| `primary-text` | `background` | text | 6.34 | 4.5 | Pass |  |
| `primary-text` | `surface` | text | 6.34 | 4.5 | Pass |  |
| `primary-text` | `surface-muted` | text | 6.06 | 4.5 | Pass |  |
| `primary-text` | `surface-sunken` | text | 5.79 | 4.5 | Pass |  |
| `primary-text` | `primary-soft on surface` | text | 5.53 | 4.5 | Pass | selected rows, Active badge |
| `foreground` | `primary-soft on surface` | text | 17.26 | 4.5 | Pass |  |
| `primary-foreground` | `primary` | text | 4.82 | 4.5 | Pass | primary button |
| `primary-foreground` | `primary-hover` | text | 6.09 | 4.5 | Pass |  |
| `primary-foreground` | `primary-active` | text | 7.74 | 4.5 | Pass |  |
| `danger-foreground` | `danger` | text | 4.83 | 4.5 | Pass | danger button |
| `danger-foreground` | `danger-hover` | text | 6.47 | 4.5 | Pass |  |
| `danger-text` | `background` | text | 6.47 | 4.5 | Pass |  |
| `danger-text` | `surface` | text | 6.47 | 4.5 | Pass |  |
| `danger-text` | `surface-muted` | text | 6.18 | 4.5 | Pass |  |
| `danger-text` | `surface-sunken` | text | 5.91 | 4.5 | Pass |  |
| `danger-text` | `danger-soft on surface` | text | 5.30 | 4.5 | Pass | soft badge |
| `danger-text` | `danger-soft on surface-muted` | text | 5.30 | 4.5 | Pass | soft badge on panel |
| `danger-text` | `surface` | text | 6.47 | 4.5 | Pass | outline badge / inline text |
| `danger-foreground` | `danger` | text | 4.83 | 4.5 | Pass | solid badge |
| `warning-text` | `warning-soft on surface` | text | 6.37 | 4.5 | Pass | soft badge |
| `warning-text` | `warning-soft on surface-muted` | text | 6.37 | 4.5 | Pass | soft badge on panel |
| `warning-text` | `surface` | text | 7.09 | 4.5 | Pass | outline badge / inline text |
| `warning-foreground` | `warning` | text | 9.22 | 4.5 | Pass | solid badge |
| `orange-text` | `orange-soft on surface` | text | 6.38 | 4.5 | Pass | soft badge |
| `orange-text` | `orange-soft on surface-muted` | text | 6.38 | 4.5 | Pass | soft badge on panel |
| `orange-text` | `surface` | text | 7.31 | 4.5 | Pass | outline badge / inline text |
| `orange-foreground` | `orange` | text | 5.56 | 4.5 | Pass | solid badge |
| `success-text` | `success-soft on surface` | text | 6.49 | 4.5 | Pass | soft badge |
| `success-text` | `success-soft on surface-muted` | text | 6.49 | 4.5 | Pass | soft badge on panel |
| `success-text` | `surface` | text | 7.13 | 4.5 | Pass | outline badge / inline text |
| `success-foreground` | `success` | text | 6.01 | 4.5 | Pass | solid badge |
| `info-text` | `info-soft on surface` | text | 6.59 | 4.5 | Pass | soft badge |
| `info-text` | `info-soft on surface-muted` | text | 6.59 | 4.5 | Pass | soft badge on panel |
| `info-text` | `surface` | text | 7.56 | 4.5 | Pass | outline badge / inline text |
| `info-foreground` | `info` | text | 7.14 | 4.5 | Pass | solid badge |
| `neutral-text` | `neutral-soft on surface` | text | 9.45 | 4.5 | Pass | soft badge |
| `neutral-text` | `neutral-soft on surface-muted` | text | 9.45 | 4.5 | Pass | soft badge on panel |
| `neutral-text` | `surface` | text | 10.35 | 4.5 | Pass | outline badge / inline text |
| `neutral-foreground` | `neutral` | text | 4.76 | 4.5 | Pass | solid badge |
| `sidebar-fg` | `sidebar-bg` | text | 4.82 | 4.5 | Pass | sidebar item |
| `sidebar-fg` | `sidebar-hover` | text | 6.09 | 4.5 | Pass | sidebar item hover |
| `sidebar-active-fg` | `sidebar-active-bg` | text | 19.80 | 4.5 | Pass | active sidebar pill |
| `danger-foreground` | `danger` | text | 4.83 | 4.5 | Pass | sidebar Logout |
| `inverse-foreground` | `inverse` | text | 16.97 | 4.5 | Pass | tooltip / snackbar |
| `#ffffff` | `project-blue` | text | 4.82 | 4.5 | Pass | project card (top) |
| `#ffffff` | `project-blue-to` | text | 8.08 | 4.5 | Pass | project card (bottom) |
| `#ffffff` | `project-green` | text | 5.27 | 4.5 | Pass | project card (top) |
| `#ffffff` | `project-green-to` | text | 8.03 | 4.5 | Pass | project card (bottom) |
| `#ffffff` | `project-pink` | text | 5.17 | 4.5 | Pass | project card (top) |
| `#ffffff` | `project-pink-to` | text | 8.10 | 4.5 | Pass | project card (bottom) |
| `#ffffff` | `project-purple` | text | 5.70 | 4.5 | Pass | project card (top) |
| `#ffffff` | `project-purple-to` | text | 8.98 | 4.5 | Pass | project card (bottom) |
| `#ffffff` | `project-teal` | text | 4.95 | 4.5 | Pass | project card (top) |
| `#ffffff` | `project-teal-to` | text | 7.81 | 4.5 | Pass | project card (bottom) |
| `#ffffff` | `project-graphite` | text | 9.48 | 4.5 | Pass | project card (top) |
| `#ffffff` | `project-graphite-to` | text | 14.97 | 4.5 | Pass | project card (bottom) |
| `input` | `background` | ui | 3.30 | 3 | Pass | input border |
| `input` | `surface-muted` | ui | 3.16 | 3 | Pass | input border on panel |
| `ring` | `background` | ui | 4.82 | 3 | Pass | focus ring |
| `ring` | `surface-sunken` | ui | 4.40 | 3 | Pass | focus ring on sunken |
| `primary` | `background` | ui | 4.82 | 3 | Pass | checked controls, progress |
| `danger` | `background` | ui | 4.83 | 3 | Pass | error border |
| `success` | `background` | ui | 3.30 | 3 | Pass | status icon |
| `sidebar-muted` | `sidebar-bg` | ui | 3.62 | 3 | Pass | sidebar icons/dividers |
| `sidebar-active-bg` | `sidebar-bg` | ui | 4.82 | 3 | Pass | active pill vs sidebar |

#### Dark theme

| Foreground | Background | Kind | Ratio | Needs | Result | Used for |
|---|---|---|--:|--:|:-:|---|
| `foreground` | `background` | text | 20.12 | 4.5 | Pass |  |
| `foreground` | `surface` | text | 18.85 | 4.5 | Pass |  |
| `foreground` | `surface-muted` | text | 18.07 | 4.5 | Pass |  |
| `foreground` | `surface-sunken` | text | 16.97 | 4.5 | Pass |  |
| `muted-foreground` | `background` | text | 8.19 | 4.5 | Pass |  |
| `muted-foreground` | `surface` | text | 7.68 | 4.5 | Pass |  |
| `muted-foreground` | `surface-muted` | text | 7.36 | 4.5 | Pass |  |
| `muted-foreground` | `surface-sunken` | text | 6.91 | 4.5 | Pass |  |
| `primary-text` | `background` | text | 6.56 | 4.5 | Pass |  |
| `primary-text` | `surface` | text | 6.15 | 4.5 | Pass |  |
| `primary-text` | `surface-muted` | text | 5.89 | 4.5 | Pass |  |
| `primary-text` | `surface-sunken` | text | 5.54 | 4.5 | Pass |  |
| `primary-text` | `primary-soft on surface` | text | 5.33 | 4.5 | Pass | selected rows, Active badge |
| `foreground` | `primary-soft on surface` | text | 16.35 | 4.5 | Pass |  |
| `primary-foreground` | `primary` | text | 4.82 | 4.5 | Pass | primary button |
| `primary-foreground` | `primary-hover` | text | 6.09 | 4.5 | Pass |  |
| `primary-foreground` | `primary-active` | text | 7.74 | 4.5 | Pass |  |
| `danger-foreground` | `danger` | text | 4.83 | 4.5 | Pass | danger button |
| `danger-foreground` | `danger-hover` | text | 6.47 | 4.5 | Pass |  |
| `danger-text` | `background` | text | 7.59 | 4.5 | Pass |  |
| `danger-text` | `surface` | text | 7.11 | 4.5 | Pass |  |
| `danger-text` | `surface-muted` | text | 6.82 | 4.5 | Pass |  |
| `danger-text` | `surface-sunken` | text | 6.40 | 4.5 | Pass |  |
| `danger-text` | `danger-soft on surface` | text | 6.15 | 4.5 | Pass | soft badge |
| `danger-text` | `danger-soft on surface-muted` | text | 5.82 | 4.5 | Pass | soft badge on panel |
| `danger-text` | `surface` | text | 7.11 | 4.5 | Pass | outline badge / inline text |
| `danger-foreground` | `danger` | text | 4.83 | 4.5 | Pass | solid badge |
| `warning-text` | `warning-soft on surface` | text | 10.65 | 4.5 | Pass | soft badge |
| `warning-text` | `warning-soft on surface-muted` | text | 9.97 | 4.5 | Pass | soft badge on panel |
| `warning-text` | `surface` | text | 13.64 | 4.5 | Pass | outline badge / inline text |
| `warning-foreground` | `warning` | text | 11.86 | 4.5 | Pass | solid badge |
| `orange-text` | `orange-soft on surface` | text | 9.58 | 4.5 | Pass | soft badge |
| `orange-text` | `orange-soft on surface-muted` | text | 9.02 | 4.5 | Pass | soft badge on panel |
| `orange-text` | `surface` | text | 11.67 | 4.5 | Pass | outline badge / inline text |
| `orange-foreground` | `orange` | text | 8.75 | 4.5 | Pass | solid badge |
| `success-text` | `success-soft on surface` | text | 8.94 | 4.5 | Pass | soft badge |
| `success-text` | `success-soft on surface-muted` | text | 8.39 | 4.5 | Pass | soft badge on panel |
| `success-text` | `surface` | text | 11.29 | 4.5 | Pass | outline badge / inline text |
| `success-foreground` | `success` | text | 8.69 | 4.5 | Pass | solid badge |
| `info-text` | `info-soft on surface` | text | 9.21 | 4.5 | Pass | soft badge |
| `info-text` | `info-soft on surface-muted` | text | 8.62 | 4.5 | Pass | soft badge on panel |
| `info-text` | `surface` | text | 11.80 | 4.5 | Pass | outline badge / inline text |
| `info-foreground` | `info` | text | 9.24 | 4.5 | Pass | solid badge |
| `neutral-text` | `neutral-soft on surface` | text | 10.61 | 4.5 | Pass | soft badge |
| `neutral-text` | `neutral-soft on surface-muted` | text | 9.94 | 4.5 | Pass | soft badge on panel |
| `neutral-text` | `surface` | text | 13.31 | 4.5 | Pass | outline badge / inline text |
| `neutral-foreground` | `neutral` | text | 4.83 | 4.5 | Pass | solid badge |
| `sidebar-fg` | `sidebar-bg` | text | 15.50 | 4.5 | Pass | sidebar item |
| `sidebar-fg` | `sidebar-hover` | text | 13.39 | 4.5 | Pass | sidebar item hover |
| `sidebar-active-fg` | `sidebar-active-bg` | text | 4.82 | 4.5 | Pass | active sidebar pill |
| `danger-foreground` | `danger` | text | 4.83 | 4.5 | Pass | sidebar Logout |
| `inverse-foreground` | `inverse` | text | 14.27 | 4.5 | Pass | tooltip / snackbar |
| `#ffffff` | `project-blue` | text | 4.82 | 4.5 | Pass | project card (top) |
| `#ffffff` | `project-blue-to` | text | 8.08 | 4.5 | Pass | project card (bottom) |
| `#ffffff` | `project-green` | text | 5.27 | 4.5 | Pass | project card (top) |
| `#ffffff` | `project-green-to` | text | 8.03 | 4.5 | Pass | project card (bottom) |
| `#ffffff` | `project-pink` | text | 5.17 | 4.5 | Pass | project card (top) |
| `#ffffff` | `project-pink-to` | text | 8.10 | 4.5 | Pass | project card (bottom) |
| `#ffffff` | `project-purple` | text | 5.70 | 4.5 | Pass | project card (top) |
| `#ffffff` | `project-purple-to` | text | 8.98 | 4.5 | Pass | project card (bottom) |
| `#ffffff` | `project-teal` | text | 4.95 | 4.5 | Pass | project card (top) |
| `#ffffff` | `project-teal-to` | text | 7.81 | 4.5 | Pass | project card (bottom) |
| `#ffffff` | `project-graphite` | text | 9.48 | 4.5 | Pass | project card (top) |
| `#ffffff` | `project-graphite-to` | text | 14.97 | 4.5 | Pass | project card (bottom) |
| `input` | `background` | ui | 3.54 | 3 | Pass | input border |
| `input` | `surface-muted` | ui | 3.18 | 3 | Pass | input border on panel |
| `ring` | `background` | ui | 6.56 | 3 | Pass | focus ring |
| `ring` | `surface-sunken` | ui | 5.54 | 3 | Pass | focus ring on sunken |
| `primary` | `background` | ui | 4.35 | 3 | Pass | checked controls, progress |
| `danger` | `background` | ui | 4.35 | 3 | Pass | error border |
| `success` | `background` | ui | 9.22 | 3 | Pass | status icon |
| `sidebar-muted` | `sidebar-bg` | ui | 7.68 | 3 | Pass | sidebar icons/dividers |
| `sidebar-active-bg` | `sidebar-bg` | ui | 4.08 | 3 | Pass | active pill vs sidebar |

<!-- contrast:end -->

## 4. Component catalog

Everything is typed, keyboard-accessible, dark-mode aware and built on `radix-ui` where a primitive exists.
Components take the React 19 `ref` as a normal prop. Import from the barrels:

```tsx
import { Button, Field, Input, useConfirm, toast } from "@/components/ui";
import { HomeShell, ProjectShell, TopBarGreeting } from "@/components/shell";
```

### 4.1 Actions

| Component | Key props | Notes |
|---|---|---|
| `Button` | `variant`: `primary` · `secondary` · `outline` · `ghost` · `danger` · `danger-outline` · `link`. `size`: `sm` · `md` · `lg` · `icon` · `icon-sm`. Also `loading`, `loadingText`, `asChild` | 44 px tall on phones, 40 px from `sm`. `loading` shows a spinner, sets `aria-busy` and blocks clicks while keeping the label. Defaults to `type="button"`. |
| `IconButton` | **`aria-label` (required)**, `variant`: `soft` · `ghost` · `outline` · `primary` · `danger`. `size`: `sm` · `md` · `lg`. Also `tooltip` (`false` disables it), `tooltipSide`, `loading`, `asChild` | Round, like the mockup header circles. The label doubles as the tooltip. |
| `buttonVariants`, `iconButtonVariants` | cva helpers | Style a `<Link>` without `asChild`. |

```tsx
<Button onClick={create}><Plus /> Add project</Button>
<Button variant="outline" asChild><Link href="/projects">View all</Link></Button>
<Button type="submit" loading={pending} loadingText="Saving…">Save changes</Button>
<IconButton aria-label="Invite collaborator" variant="outline"><UserPlus /></IconButton>
```

### 4.2 Forms

| Component | Key props | Notes |
|---|---|---|
| `Field` | `label`, `hint`, `error`, `required`, `disabled`, `htmlFor`, `labelAside` | Wires `id`, `aria-describedby`, `aria-invalid` and `aria-required` into any child control from components/ui. `error` replaces `hint` and is announced (`role="alert"`). |
| `FormField` (react-hook-form) | `control`, `name`, `label`, `hint`, `required`, `render` | A `Controller` inside a `Field`. The zod message becomes the error. Use `mode: "onTouched"` so errors appear on blur and on submit. Also `Form` (= `FormProvider`), `FormError`, `useFormRootError()`. |
| `Input` | `leading`, `trailing`, `invalid`, `wrapperClassName` | Icon or prefix slots. |
| `PasswordInput` | all `Input` props | Show/hide toggle with `aria-pressed`. |
| `Textarea` | `invalid` | |
| `Label` | `required` | Red `*` marker plus a screen-reader "required". |
| `Select` (+ `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`, `SelectGroup`, `SelectLabel`, `SelectSeparator`) | Radix Select | The trigger reads Field context. |
| `Checkbox` | `label`, `description`, `checked` (`true` · `false` · `"indeterminate"`) | |
| `Switch` | `label`, `description` | |
| `RadioGroup` / `RadioGroupItem` | `label`, `description` | |
| `ChoiceCard` | `value`, `title`, `description`, `icon`, `footer` | Big selectable card inside `<RadioGroup>` (onboarding role picker). |
| `SegmentedControl` | `options` `{value,label,icon?,iconOnly?}`, `value`, `onValueChange`, **`aria-label`**, `size`, `fullWidth` | Hours\|Days, Graph\|List, Light\|Dark\|System. Always one value. |
| `CurrencyInput` | `value: number \| null`, `onValueChange(number \| null)`, `symbol` | `₱` prefix. Formats `1,250,000.00` on blur. Emits a number rounded to centavos. |
| `DateInput` | `value: "YYYY-MM-DD"`, `onValueChange`, `min`, `max` | Styled native date input. |
| `ColorSwatchPicker` | `value: ProjectColorKey`, `onValueChange`, `size` | Radio semantics over `PROJECT_COLOR_KEYS`. |

```tsx
const form = useForm<Values>({ resolver: zodResolver(schema), mode: "onTouched" });

<Form {...form}>
  <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5">
    <FormError>{form.formState.errors.root?.serverError?.message}</FormError>
    <FormField control={form.control} name="name" label="Project name" required
      hint="3–120 characters, unique within your company."
      render={({ field }) => <Input {...field} placeholder="e.g. Cebu Coastal Road Widening" />} />
    <FormField control={form.control} name="budget" label="Estimated budget" required
      render={({ field }) => <CurrencyInput value={field.value} onValueChange={field.onChange} onBlur={field.onBlur} />} />
    <Button type="submit" loading={form.formState.isSubmitting}>Create project</Button>
  </form>
</Form>
```

To map a server `ActionResult` error, call `form.setError(name, { message })` for each entry in `fieldErrors`,
then `form.setError("root.serverError", { message })` for the summary.

### 4.3 Overlays

| Component | Key props | Notes |
|---|---|---|
| `Modal` | `open`, `onOpenChange`, `trigger`, `title`, `description`, `footer`, `size` (`sm` · `md` · `lg` · `xl`), `dismissible` | Header, scrolling body and footer in one. A centered card from 640 px. **A bottom sheet with a grab handle on phones.** Footer buttons stack full-width with the primary on top. |
| `Dialog` + `DialogContent` (`size`, `showClose`), `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogBody`, `DialogFooter`, `DialogTrigger`, `DialogClose` | Radix Dialog | Compose your own layout. |
| `Sheet` + `SheetContent` (`side`: `right` · `left` · `bottom` · `top`, `showClose`, `closeClassName`), `SheetHeader`, `SheetTitle`, `SheetDescription`, `SheetBody`, `SheetFooter` | Radix Dialog | Filters, details, mobile navigation. |
| `ConfirmDialog` / `useConfirm()` | see §5.6 | Alert dialog, danger tone, type-to-confirm. |
| `Popover`, `PopoverTrigger`, `PopoverContent`, `PopoverAnchor`, `PopoverClose` | | Collision-aware and height-capped to the viewport. |
| `DropdownMenu` + `…Content`, `…Item` (`variant: "danger"`, `inset`), `…CheckboxItem`, `…RadioGroup`/`…RadioItem`, `…Label`, `…Separator`, `…Shortcut`, `…Sub`/`…SubTrigger`/`…SubContent` | Radix Menu | |
| `Tooltip`, `TooltipTrigger`, `TooltipContent`, `SimpleTooltip` (`content`, `side`, `disabled`) | | Uses the `inverse` surface. Never put essential information in a tooltip only. |

### 4.4 Display

| Component | Key props | Notes |
|---|---|---|
| `Badge` | `tone`: `neutral` · `primary` · `info` · `success` · `warning` · `orange` · `danger`. `variant`: `soft` · `solid` · `outline`. `size`: `sm` · `md` · `lg`. Also `icon`, `dot` | |
| `StatusBadge` | `status: StatusKey`, `label`, `hideIcon`, plus Badge `variant` and `size` | Activity: `not_started` · `ongoing` · `delayed` · `on_hold` · `completed`. Project: `planning` · `active` · `on_hold` · `completed` · `cancelled`. Derived: `delayed` · `budget_exceeded` · `near_budget_limit`. Helpers: `STATUS_META`, `getStatusMeta`, `getStatusTone`, `getStatusLabel`, `getStatusIcon`, plus the `ACTIVITY_STATUSES`, `PROJECT_STATUSES` and `DERIVED_BADGES` arrays. |
| `Avatar` | `name`, `src`, `size` (`xs`–`xl`), `ring` | Initials fallback with a deterministic soft color. `AvatarGroup` takes `people`, `max` ("+N") and `size`. |
| `ProjectAvatar` | `name`, `color`, `size` (`sm`–`xl`) | Gradient circle with project initials. |
| `Card` (`variant`: `default` · `muted` · `interactive`), `CardHeader`, `CardTitle`, `CardDescription`, `CardAction`, `CardContent`, `CardFooter` | | 16 px radius, 20–24 px padding. |
| `StatCard` | `label`, `value`, `icon`, `tone`, `delta {value, trend, sentiment}`, `hint`, `footer` | KPI tile. `sentiment` decides the color, because an "up" in cost is bad. |
| `Progress` | `value` (0–100 or `null` for indeterminate), `tone` (`auto` = blue, then green at 100), `size`, `label`, `showValue` | |
| `Meter` | `allocated`, `budget`, `label`, `threshold` (0.9), `formatValue`, `size`, `hideSummary` | Budget meter. Within is blue, near is amber with an icon, exceeded is red with an icon. Summary: "₱8.2M of ₱10M · ₱1.8M remaining". `getBudgetState()` is exported. |
| `TableContainer`, `Table` (`dense`, `zebra`), `TableHeader`, `TableBody`, `TableFooter`, `TableRow` (`data-state="selected"`), `TableHead` (`numeric`), `TableCell` (`numeric`), `TableCaption`, `TableEmpty` (`colSpan`) | | Give `TableContainer` a max height for a sticky header. Zebra rows use `surface-muted`. |
| `EmptyState` | `icon`, `title`, `description`, `action`, `secondaryAction`, `checklist`, `variant` (`dashed` · `plain`), `size`, `headingLevel` | Every list has one. |
| `Skeleton`, `SkeletonText` (`lines`), `SkeletonCard`, `LoadingLabel` | | Page loads use skeletons, not spinners. |
| `Spinner` | `size` (`xs`–`lg`), `label` (`null` when a parent already sets aria-busy) | |
| `PageHeader` | `title`, `description`, `breadcrumbs`, `meta`, `actions`, `leading` | One `h1` per page. |
| `SectionHeader` | `title`, `description`, `actions`, `count`, `as` | |
| `Tabs`, `TabsList` (`variant`: `pill` · `underline`), `TabsTrigger`, `TabsContent` | | |
| `Kbd`, `Separator`, `ScrollArea`, `VisuallyHidden` | | |
| Formatting | `formatPeso`, `formatPesoCompact`, `formatGrouped`, `parseDecimal`, `getInitials`, `getProjectInitials` | |

### 4.5 Shell (`@/components/shell`)

Presentational only. All data and callbacks come in through props, with no Supabase calls inside.

| Component | Key props |
|---|---|
| `Logo` | `variant` (`color` · `white`), `size` (`sm` · `md` · `lg`), `markOnly`, `priority` |
| `TopBar` | `leading`, `onSearchClick`, `searchPlaceholder`, `notifications: NotificationBellProps`, `user: UserMenuProps`, `showThemeToggle`, `actions`, `onMenuClick`, `sticky`, `innerClassName`. Sticky, and gains blur and a border once the page scrolls. The pill search collapses to an icon below `lg`. |
| `TopBarGreeting` | `eyebrow`, `title`, `leading` ("Welcome back" / name, company logo) |
| `ThemeToggle` | `variant` (`menu` · `segmented`). Also `useThemeChoice()` and `THEME_OPTIONS`. |
| `NotificationBell` | `notifications: NotificationItem[]` (`id`, `type`, `title`, `body`, `createdAt`, `read`, `href`, `projectId`, `projectName`, `tone`), `unreadCount`, `projects` (per-project filter), `projectFilter`/`onProjectFilterChange`, `onMarkAllRead`, `onItemSelect`, `viewAllHref`, `loading`, `now` |
| `UserMenu` | `user {name, email, avatarUrl, subtitle}`, `signOut` (`{ action }` POST form or server action, or `{ onSignOut }`), `profileHref`, `settingsHref`, `showTheme`, `children` |
| `CommandPalette` | `open`, `onOpenChange`, `groups [{id, heading, items}]`, item `{id, label, hint, icon, keywords, href \| onSelect, shortcut, disabled}`, `recent`, `placeholder`, `enableShortcut` (global ⌘K/Ctrl+K), `onQueryChange`, `shouldFilter`, `loading`, `toolbar`. Also `useCommandPaletteShortcut()`. |
| `ProjectSidebar` | `project {name, color, status, derivedBadges}`, `items: ProjectNavItem[]`, `activeId` (defaults to the longest matching href), `allProjectsHref`, `signOut`, `collapsed`/`onCollapsedChange`, `onNavigate`, `mode` (`rail` · `sheet`). Helpers: `getProjectNavItems(projectId)` (Gantt and S-Curve are marked `soon`), `findActiveNavId`, `useSidebarCollapsed()`. |
| `HomeShell` | `topBar`, `palette`, `children`, `contentClassName`: sticky top bar plus centered content up to 80rem, with a skip link |
| `ProjectShell` | `sidebar`, `topBar`, `palette`, `children`: floating sidebar rail (collapsible on `lg`, persisted), off-canvas Sheet below `lg` opened by the top-bar hamburger |

```tsx
<ProjectShell
  sidebar={{ project: { name, color, status: "active", derivedBadges: ["delayed"] },
             items: getProjectNavItems(projectId), signOut: { action: "/auth/signout" } }}
  topBar={{ leading: <TopBarGreeting eyebrow="Projects" title={name} />, notifications, user }}
  palette={{ groups }}
>
  <PageHeader title="Dashboard" meta={<StatusBadge status="active" />} actions={<Button>Propose inspection</Button>} />
  …
</ProjectShell>
```

## 5. Patterns

### 5.1 Page header

`PageHeader` holds the `h1`, an optional description, `meta` badges (status first, then derived badges),
breadcrumbs above, and actions on the right. Actions wrap below the title on phones. Use at most one `primary`
button, with the rest `outline` or `ghost`.

### 5.2 Forms

- Wrap each control in `Field` (or `FormField`). Never place a bare input next to a bare label.
- Validate on blur and on submit (`mode: "onTouched"`). Errors say what's wrong and how to fix it: "Use at least
  10 characters.", not "Invalid".
- Mark required fields with `required`, which adds the red `*` and `aria-required`. Hints go under the control.
- Show server errors without a field in `FormError` at the top of the form. Map `fieldErrors` onto fields.
- Primary submit goes bottom-right on desktop and full-width on phones. Cancel is `outline`.
- Use `CurrencyInput` for money and `DateInput` for calendar dates (ISO `YYYY-MM-DD`). Hours versus days use a
  `SegmentedControl`.

### 5.3 Tables

`TableContainer` + `Table`. Header labels are short sentence-case captions in `muted-foreground`. Right-align
numbers with `numeric`, which also applies `tabular-nums`. Use `dense` for WBS-like grids, `zebra` for long
read-only lists, and `data-state="selected"` for the selected row (`primary-soft`). When a table is empty,
render `TableEmpty` with an action. Never leave a blank table body.

### 5.4 Cards

Use `Card` for grouped content and `StatCard` for KPIs, with values in `tabular-nums`. Project cards use the
`getProjectColor(key).gradient` background, white text, status and derived badges at the top, title, location,
dates, and progress at the bottom (mockup 7, improved per D31). Interactive cards (`<Card variant="interactive">`) lift on
hover and show the focus ring on keyboard focus.

### 5.5 Empty states

Explain what goes here, why it's empty, and offer the action that fills it (`EmptyState action`). First-run
screens add a `checklist` (spec §4.2). Inside cards use `variant="plain" size="sm"`.

### 5.6 Destructive flows: `useConfirm()`

`ConfirmProvider` is already mounted in `src/components/providers.tsx`.

```tsx
const confirm = useConfirm();

async function onDelete() {
  const ok = await confirm({
    title: `Delete "${deliverable.name}"?`,
    description: "Deletes 4 sub-deliverables and 11 work packages. You can restore them from Audit Trail within 30 days.",
    tone: "danger",                 // red icon + red confirm button
    confirmLabel: "Delete deliverable",
    cancelLabel: "Cancel",
    // confirmText: project.name,   // require typing the name (cancel/delete project)
  });
  if (!ok) return;                  // false on Cancel, Esc or outside click
  const result = await deleteDeliverable(deliverable.id);
  if (!result.ok) return toast.error("Couldn't delete", { description: result.error.message });
  toast.undo("Deliverable deleted", () => restoreDeliverable(deliverable.id));
}
```

Rules: the title is a question naming the object. The description states the impact in numbers. The confirm
label repeats the verb ("Delete deliverable", never "OK"). `confirmText` is for irreversible or
project-wide actions only. On phones the dialog is a bottom sheet with full-width buttons, confirm on top.

### 5.7 Feedback and Undo: `toast`

`<Toaster />` is mounted in Providers. It sits bottom-right on desktop and full-width bottom on phones. It is a
dark snackbar in both themes.

```tsx
toast.success("Project created", { description: "Cebu Coastal Road Widening" });
toast.error("Couldn't save changes", { description: "You're offline. We'll retry.", action: { label: "Retry", onClick: retry } });
toast.warning("Budget exceeded", { description: "Allocated ₱11.2M is ₱1.2M over the ₱10M budget." });
toast.info("Baseline v1 captured");
toast.undo("Work package moved to 2.1", () => undoMove());        // success + Undo, 8 s
toast.promise(save(), { loading: "Saving…", success: "Saved", error: "Couldn't save" });
toast.dismiss(id);
```

Prefer **Undo** over a confirm dialog for reversible actions (move, archive, mark complete). Actions keep the
toast open for 8 s. Never put information that matters only in a toast. The page must reflect the new state too.

### 5.8 Loading and errors

Route `loading.tsx` files render skeletons shaped like the page (`SkeletonCard`, `SkeletonText`). In-flight
buttons use `loading`. Background refreshes don't block the UI. Error boundaries use `EmptyState` with a danger
icon and a "Try again" action.

## 6. Do / Don't

| Do | Don't |
|---|---|
| Use tokens: `bg-surface`, `text-danger-text`, `border-border-strong` | Hard-code `#hex`, `bg-blue-600`, `text-red-500` |
| Pair status color with an icon and a label (`StatusBadge`) | Show a red dot or red text as the only signal |
| One solid primary button per screen | Two blue buttons fighting for attention |
| Use `danger` only for destructive actions (delete, remove, sign out) | Use red for "Delayed" buttons or decoration |
| Give project cards blue, green, pink, purple, teal or graphite | Give a project card red, orange or yellow |
| `primary-text` for links and blue text | `text-primary` on small text (fails AA in dark mode) |
| `IconButton` with an `aria-label` | Icon-only `<button>` with no accessible name |
| `useConfirm` stating the impact. `toast.undo` for reversible actions | "Are you sure?" with OK/Cancel |
| Skeletons that match the final layout | Full-page spinners, layout jumps |
| `tabular-nums` for money, dates and percentages | Proportional digits in columns |
| `Field` / `FormField` around every control | Placeholder-only labels |
| Keep typography utilities out of `cn()` with text colors | `cn("text-h2", "text-foreground")` (drops `text-h2`) |
| Check both themes and a 390 px viewport | Ship after checking light desktop only |
