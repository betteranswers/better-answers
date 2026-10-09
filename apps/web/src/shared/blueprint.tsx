import { Slot } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "@/shared/lib/utils.ts";

/** The marked primitive: no fill, one hairline, for a figure or a region rather than content. */
export function Frame({
  className,
  asChild = false,
  ...props
}: ComponentProps<"div"> & { readonly asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "div";

  return (
    <Comp
      data-slot="frame"
      data-marks=""
      className={cn("border border-border", className)}
      {...props}
    />
  );
}

/** Behind its parent's content, which must be `relative isolate` so the layer stays inside it. */
const LAYER = "pointer-events-none absolute inset-0 -z-10";

/** The page's substrate at the layout's own pitch: one per page, never inside a card or dialog. */
export function GridPattern(properties: { readonly className?: string }) {
  return <div aria-hidden data-grid-pattern="" className={cn(LAYER, properties.className)} />;
}

/** "Nothing is here yet": a bounded empty area only, never behind content. */
export function DotPattern(properties: { readonly className?: string }) {
  return <div aria-hidden data-dot-pattern="" className={cn(LAYER, properties.className)} />;
}
