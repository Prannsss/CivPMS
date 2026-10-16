"use client";

import { createContext, useContext } from "react";
import { Tabs as TabsPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

type TabsVariant = "pill" | "underline";

const TabsVariantContext = createContext<TabsVariant>("pill");

export const Tabs = TabsPrimitive.Root;

export type TabsListProps = React.ComponentProps<typeof TabsPrimitive.List> & {
  /** `pill`: segmented pills on a sunken track. `underline`: page-level tabs with a blue indicator. */
  variant?: TabsVariant;
};

export function TabsList({ className, variant = "pill", ...props }: TabsListProps) {
  return (
    <TabsVariantContext.Provider value={variant}>
      <TabsPrimitive.List
        data-variant={variant}
        className={cn(
          variant === "pill"
            ? "inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full bg-surface-sunken p-1"
            : "flex max-w-full items-center gap-1 overflow-x-auto border-b border-border",
          className,
        )}
        {...props}
      />
    </TabsVariantContext.Provider>
  );
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const variant = useContext(TabsVariantContext);
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-2 font-medium whitespace-nowrap text-muted-foreground transition-[color,background-color,box-shadow] duration-150 focus-ring",
        "hover:text-foreground disabled:pointer-events-none disabled:opacity-50",
        "[&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        variant === "pill" &&
          "h-9 rounded-full px-4 text-[13px] data-[state=active]:bg-surface data-[state=active]:text-foreground data-[state=active]:shadow-sm sm:h-8 dark:data-[state=active]:bg-border-strong",
        variant === "underline" &&
          "relative -mb-px h-11 rounded-t-sm border-b-2 border-transparent px-3 text-sm data-[state=active]:border-primary data-[state=active]:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn("mt-4 rounded-sm focus-ring", className)} {...props} />;
}
