"use client";

import { DropdownMenu as MenuPrimitive } from "radix-ui";
import { Check, ChevronRight, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;
export const DropdownMenuGroup = MenuPrimitive.Group;
export const DropdownMenuPortal = MenuPrimitive.Portal;
export const DropdownMenuSub = MenuPrimitive.Sub;
export const DropdownMenuRadioGroup = MenuPrimitive.RadioGroup;

const contentClasses = cn(
  "z-50 min-w-48 overflow-x-hidden overflow-y-auto rounded-md border border-border bg-surface p-1 text-foreground shadow-popover",
  "max-h-(--radix-dropdown-menu-content-available-height) origin-(--radix-dropdown-menu-content-transform-origin)",
  "data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out",
);

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  align = "end",
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content sideOffset={sideOffset} align={align} className={cn(contentClasses, className)} {...props} />
    </MenuPrimitive.Portal>
  );
}

const itemClasses = cn(
  "relative flex min-h-10 cursor-default items-center gap-2.5 rounded-sm px-2.5 py-2 text-sm outline-none select-none sm:min-h-9",
  "data-[highlighted]:bg-surface-sunken",
  "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
  "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
);

export type DropdownMenuItemProps = React.ComponentProps<typeof MenuPrimitive.Item> & {
  /** `danger` for destructive items such as Sign out or Delete. */
  variant?: "default" | "danger";
  inset?: boolean;
};

export function DropdownMenuItem({ className, variant = "default", inset, ...props }: DropdownMenuItemProps) {
  return (
    <MenuPrimitive.Item
      data-variant={variant}
      className={cn(
        itemClasses,
        variant === "default" && "[&_svg]:text-muted-foreground",
        variant === "danger" && "text-danger-text data-[highlighted]:bg-danger-soft [&_svg]:text-danger-text",
        inset && "pl-9",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.CheckboxItem>) {
  return (
    <MenuPrimitive.CheckboxItem className={cn(itemClasses, "pl-9", className)} {...props}>
      <span className="absolute left-2.5 flex size-4 items-center justify-center">
        <MenuPrimitive.ItemIndicator>
          <Check aria-hidden className="text-primary-text" />
        </MenuPrimitive.ItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  );
}

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.RadioItem>) {
  return (
    <MenuPrimitive.RadioItem className={cn(itemClasses, "pl-9 [&_svg]:text-muted-foreground", className)} {...props}>
      <span className="absolute left-3 flex size-3 items-center justify-center">
        <MenuPrimitive.ItemIndicator>
          <Circle aria-hidden className="size-2! fill-primary text-primary!" />
        </MenuPrimitive.ItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  );
}

export function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Label> & { inset?: boolean }) {
  return (
    <MenuPrimitive.Label
      className={cn("px-2.5 pt-2 pb-1 text-xs font-medium text-muted-foreground", inset && "pl-9", className)}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof MenuPrimitive.Separator>) {
  return <MenuPrimitive.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />;
}

export function DropdownMenuShortcut({ className, ...props }: React.ComponentProps<"span">) {
  return <span className={cn("ml-auto pl-4 text-xs tracking-wide text-muted-foreground", className)} {...props} />;
}

export function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.SubTrigger> & { inset?: boolean }) {
  return (
    <MenuPrimitive.SubTrigger
      className={cn(itemClasses, "data-[state=open]:bg-surface-sunken [&_svg]:text-muted-foreground", inset && "pl-9", className)}
      {...props}
    >
      {children}
      <ChevronRight aria-hidden className="ml-auto" />
    </MenuPrimitive.SubTrigger>
  );
}

export function DropdownMenuSubContent({ className, ...props }: React.ComponentProps<typeof MenuPrimitive.SubContent>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.SubContent className={cn(contentClasses, "min-w-40", className)} {...props} />
    </MenuPrimitive.Portal>
  );
}
