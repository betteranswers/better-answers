import type { ReactNode } from "react";

import { cn } from "@/shared/lib/utils.ts";

/**
 * `action` only where the screen has no other way to take the act: a second button for it reads
 * as a different act.
 */
export function EmptyState(properties: {
  readonly line: string;
  readonly action?: ReactNode;
  readonly className?: string;
}) {
  return (
    <div className={cn("grid justify-items-start gap-2", properties.className)}>
      <p>{properties.line}</p>
      {properties.action}
    </div>
  );
}
