import { VisuallyHidden as VisuallyHiddenPrimitive } from "radix-ui";

/** Hides content visually while keeping it available to screen readers. */
export function VisuallyHidden(props: React.ComponentProps<typeof VisuallyHiddenPrimitive.Root>) {
  return <VisuallyHiddenPrimitive.Root {...props} />;
}
