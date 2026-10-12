"use client";

import type { ReactNode } from "react";
import { ThemeProvider } from "next-themes";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * next-themes injects an inline script that sets the theme class before first paint (it runs from the
 * server HTML). On the client React 19 warns about rendering a <script>; marking it as a data block
 * there silences the warning without affecting the server-rendered, executed script.
 */
const themeScriptProps = { type: typeof window === "undefined" ? "text/javascript" : "application/json" };

/** App-wide client providers: theme (light/dark/system), tooltips, confirm dialogs and snackbars. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      scriptProps={themeScriptProps}
    >
      <TooltipProvider delayDuration={300} skipDelayDuration={150}>
        <ConfirmProvider>
          {children}
          <Toaster />
        </ConfirmProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}
