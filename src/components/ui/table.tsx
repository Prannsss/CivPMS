"use client";

import { createContext, useContext } from "react";
import { cn } from "@/lib/utils";

type TableContextValue = { dense: boolean; zebra: boolean };
const TableContext = createContext<TableContextValue>({ dense: false, zebra: false });

/**
 * Scroll container with a border. Give it a max height (e.g. `max-h-[60vh]`) to get a sticky header.
 */
export function TableContainer({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="table-container"
      className={cn("relative w-full overflow-auto rounded-lg border border-border bg-surface", className)}
      {...props}
    />
  );
}

export type TableProps = React.ComponentProps<"table"> & {
  /** Compact rows (36px) for data-heavy screens (WBS list, audit trail). */
  dense?: boolean;
  /** Alternate row backgrounds using surface-muted. */
  zebra?: boolean;
};

export function Table({ className, dense = false, zebra = false, ...props }: TableProps) {
  return (
    <TableContext.Provider value={{ dense, zebra }}>
      <table data-slot="table" className={cn("w-full caption-bottom border-collapse text-sm", className)} {...props} />
    </TableContext.Provider>
  );
}

export function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      className={cn(
        "sticky top-0 z-10 bg-surface-muted shadow-[inset_0_-1px_0_var(--border)] [&_tr]:border-0",
        className,
      )}
      {...props}
    />
  );
}

export function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  const { zebra } = useContext(TableContext);
  return (
    <tbody
      className={cn("[&_tr:last-child]:border-0", zebra && "[&>tr:nth-child(even):not([data-state=selected])]:bg-surface-muted", className)}
      {...props}
    />
  );
}

export function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return <tfoot className={cn("border-t border-border bg-surface-muted font-medium", className)} {...props} />;
}

export function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      className={cn(
        "border-b border-border transition-colors hover:bg-surface-sunken/70 data-[state=selected]:bg-primary-soft",
        className,
      )}
      {...props}
    />
  );
}

export function TableHead({ className, numeric, ...props }: React.ComponentProps<"th"> & { numeric?: boolean }) {
  const { dense } = useContext(TableContext);
  return (
    <th
      scope="col"
      className={cn(
        "px-4 text-left align-middle text-xs font-semibold whitespace-nowrap text-muted-foreground",
        dense ? "h-9" : "h-11",
        numeric && "text-right",
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, numeric, ...props }: React.ComponentProps<"td"> & { numeric?: boolean }) {
  const { dense } = useContext(TableContext);
  return (
    <td
      className={cn(
        "px-4 align-middle text-foreground",
        dense ? "h-9 py-1.5 text-[13px]" : "h-14 py-3",
        numeric && "text-right tabular-nums",
        className,
      )}
      {...props}
    />
  );
}

export function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return <caption className={cn("py-3 text-xs text-muted-foreground", className)} {...props} />;
}

/** Full-width row for empty/loading/error messages inside a table body. */
export function TableEmpty({ colSpan, children, className }: { colSpan: number; children: React.ReactNode; className?: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className={cn("px-4 py-10 text-center text-sm text-muted-foreground", className)}>
        {children}
      </td>
    </tr>
  );
}
