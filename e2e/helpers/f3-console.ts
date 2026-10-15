import { expect, type Page } from "@playwright/test";

/**
 * Collects browser console errors, hydration warnings and uncaught exceptions for a page.
 * Call `expectClean()` at the end of a test.
 */
export function watchConsole(page: Page): { messages: string[]; expectClean: () => void } {
  const messages: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error" || /hydrat/i.test(text)) messages.push(`console.${message.type()}: ${text}`);
  });
  page.on("pageerror", (error) => messages.push(`pageerror: ${error.message}`));
  return {
    messages,
    expectClean: () => expect(messages, messages.join("\n")).toEqual([]),
  };
}
