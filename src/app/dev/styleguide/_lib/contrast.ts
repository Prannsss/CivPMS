/**
 * WCAG 2.1 contrast helpers. Pure and dependency-free so they run both in the browser
 * (styleguide swatches) and in Node (`check-contrast.mjs`, via type stripping).
 */

export type Rgba = { r: number; g: number; b: number; a: number };

export function parseColor(input: string): Rgba | null {
  const value = input.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(value);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }
  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(value);
  if (fn) {
    const alphaRaw = fn[4];
    const a =
      alphaRaw === undefined
        ? 1
        : alphaRaw.endsWith("%")
          ? parseFloat(alphaRaw) / 100
          : parseFloat(alphaRaw);
    return { r: parseFloat(fn[1]), g: parseFloat(fn[2]), b: parseFloat(fn[3]), a };
  }
  return null;
}

/** Alpha-composite `top` over an opaque `bottom`. */
export function composite(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a;
  return {
    r: top.r * a + bottom.r * (1 - a),
    g: top.g * a + bottom.g * (1 - a),
    b: top.b * a + bottom.b * (1 - a),
    a: 1,
  };
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function luminance(c: Rgba): number {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

export function contrastRatio(fg: Rgba, bg: Rgba): number {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Contrast of `fg` drawn on `bg`, where `bg` may itself be translucent and sits on `base`
 * (e.g. a 16% tinted badge on a dark surface).
 */
export function pairContrast(fg: string, bg: string, base: string): number | null {
  const f = parseColor(fg);
  const b = parseColor(bg);
  const p = parseColor(base);
  if (!f || !b || !p) return null;
  const solidBase = composite(p, { r: 255, g: 255, b: 255, a: 1 });
  const solidBg = composite(b, solidBase);
  const solidFg = composite(f, solidBg);
  return contrastRatio(solidFg, solidBg);
}

export type PairKind = "text" | "ui";

export type TokenPair = {
  fg: string;
  bg: string;
  /** Opaque token the background sits on (for translucent backgrounds). */
  base?: string;
  kind: PairKind;
  note?: string;
};

/** Required ratio: 4.5 for normal text, 3 for UI parts / large text (WCAG 2.1 AA). */
export function requiredRatio(kind: PairKind): number {
  return kind === "text" ? 4.5 : 3;
}

const PROJECT_KEYS = ["blue", "green", "pink", "purple", "teal", "graphite"] as const;

const surfaces = ["background", "surface", "surface-muted", "surface-sunken"] as const;
const tones = ["danger", "warning", "orange", "success", "info", "neutral"] as const;

/** Every foreground/background combination the components actually render. */
export const TOKEN_PAIRS: TokenPair[] = [
  ...surfaces.map((bg): TokenPair => ({ fg: "foreground", bg, kind: "text" })),
  ...surfaces.map((bg): TokenPair => ({ fg: "muted-foreground", bg, kind: "text" })),
  ...surfaces.map((bg): TokenPair => ({ fg: "primary-text", bg, kind: "text" })),
  { fg: "primary-text", bg: "primary-soft", base: "surface", kind: "text", note: "selected rows, Active badge" },
  { fg: "foreground", bg: "primary-soft", base: "surface", kind: "text" },
  { fg: "primary-foreground", bg: "primary", kind: "text", note: "primary button" },
  { fg: "primary-foreground", bg: "primary-hover", kind: "text" },
  { fg: "primary-foreground", bg: "primary-active", kind: "text" },
  { fg: "danger-foreground", bg: "danger", kind: "text", note: "danger button" },
  { fg: "danger-foreground", bg: "danger-hover", kind: "text" },
  ...surfaces.map((bg): TokenPair => ({ fg: "danger-text", bg, kind: "text" })),
  ...tones.flatMap((t): TokenPair[] => [
    { fg: `${t}-text`, bg: `${t}-soft`, base: "surface", kind: "text", note: "soft badge" },
    { fg: `${t}-text`, bg: `${t}-soft`, base: "surface-muted", kind: "text", note: "soft badge on panel" },
    { fg: `${t}-text`, bg: "surface", kind: "text", note: "outline badge / inline text" },
    { fg: `${t}-foreground`, bg: t, kind: "text", note: "solid badge" },
  ]),
  { fg: "sidebar-fg", bg: "sidebar-bg", kind: "text", note: "sidebar item" },
  { fg: "sidebar-fg", bg: "sidebar-hover", kind: "text", note: "sidebar item hover" },
  { fg: "sidebar-active-fg", bg: "sidebar-active-bg", kind: "text", note: "active sidebar pill" },
  { fg: "danger-foreground", bg: "danger", kind: "text", note: "sidebar Logout" },
  { fg: "inverse-foreground", bg: "inverse", kind: "text", note: "tooltip / snackbar" },
  ...PROJECT_KEYS.flatMap((k): TokenPair[] => [
    { fg: "#ffffff", bg: `project-${k}`, kind: "text", note: "project card (top)" },
    { fg: "#ffffff", bg: `project-${k}-to`, kind: "text", note: "project card (bottom)" },
  ]),
  // Non-text UI parts (WCAG 1.4.11, 3:1)
  { fg: "input", bg: "background", kind: "ui", note: "input border" },
  { fg: "input", bg: "surface-muted", kind: "ui", note: "input border on panel" },
  { fg: "ring", bg: "background", kind: "ui", note: "focus ring" },
  { fg: "ring", bg: "surface-sunken", kind: "ui", note: "focus ring on sunken" },
  { fg: "primary", bg: "background", kind: "ui", note: "checked controls, progress" },
  { fg: "danger", bg: "background", kind: "ui", note: "error border" },
  { fg: "success", bg: "background", kind: "ui", note: "status icon" },
  { fg: "sidebar-muted", bg: "sidebar-bg", kind: "ui", note: "sidebar icons/dividers" },
  { fg: "sidebar-active-bg", bg: "sidebar-bg", kind: "ui", note: "active pill vs sidebar" },
];
