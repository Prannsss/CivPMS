"use client";

import { toast } from "@/components/ui/toaster";

/** Copies text and confirms with a snackbar; falls back to an error that shows the text. */
export async function copyToClipboard(text: string, successTitle: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(successTitle);
    return true;
  } catch {
    toast.error("Couldn't copy automatically", { description: `Select and copy it yourself: ${text}` });
    return false;
  }
}
