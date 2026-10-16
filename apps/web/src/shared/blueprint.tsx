import { Slot } from "radix-ui";
import type { ComponentProps, ReactElement } from "react";

import { cn } from "@/shared/lib/utils.ts";

/**
 * The marked primitive: no fill, one hairline, for a figure or a region rather than content. Not
 * the shell's frame.
 */
export function MarkedRegion({
  className,
  asChild = false,
  ...props
}: ComponentProps<"div"> & { readonly asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "div";

  return (
    <Comp
      data-slot="marked-region"
      data-marks=""
      className={cn("border border-border", className)}
      {...props}
    />
  );
}

export function GridPattern(properties: { readonly children: ReactElement }) {
  return <Slot.Root data-grid-pattern="">{properties.children}</Slot.Root>;
}

export function DotPattern(properties: { readonly children: ReactElement }) {
  return <Slot.Root data-dot-pattern="">{properties.children}</Slot.Root>;
}
