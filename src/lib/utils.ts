import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge only knows Tailwind's built-in scale. Register our typography
 * utilities (globals.css @utility text-*) as font sizes so `cn("text-h2", "text-foreground")`
 * keeps both classes instead of treating text-h2 as a color.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["display", "h1", "h2", "h3", "body", "body-lg", "label", "caption"] }],
    },
  },
});

/** Merge Tailwind classes, letting later classes win over earlier conflicting ones. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
