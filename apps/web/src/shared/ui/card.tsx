import { Slot } from "radix-ui";
import * as React from "react";

import { cn } from "@/shared/lib/utils.ts";

/** `marks` registers a card that is a direct child of the grid; nested inside another, it draws none. */
function Card({
  className,
  marks = false,
  asChild = false,
  ...props
}: React.ComponentProps<"div"> & { marks?: boolean; asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "div";

  return (
    <Comp
      data-slot="card"
      data-marks={marks ? "" : undefined}
      className={cn("flex flex-col border border-border bg-card text-card-foreground", className)}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1 px-4 pt-4 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-4",
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"div"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "div";

  return <Comp data-slot="card-title" className={cn("font-semibold", className)} {...props} />;
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("p-4", className)} {...props} />;
}

/** The sunken strip a card's provenance sits in. */
function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "mt-auto flex items-center gap-2 border-t border-border bg-muted px-4 py-2 text-sm text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent };
