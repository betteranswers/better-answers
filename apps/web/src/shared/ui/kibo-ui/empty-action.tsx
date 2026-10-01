import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/shared/lib/utils.ts";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/shared/ui/empty.tsx";

export type EmptyActionProps = Omit<ComponentProps<typeof Empty>, "title"> & {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
};

export const EmptyAction = ({
  title,
  description,
  action,
  className,
  ...props
}: EmptyActionProps) => (
  <Empty
    className={cn("items-start gap-3 px-4 py-10 text-left md:px-4 md:py-10", className)}
    {...props}
  >
    <EmptyHeader className="max-w-none items-start gap-1 text-left">
      <EmptyTitle className="[font-size:var(--text-base)]">{title}</EmptyTitle>
      {description === undefined ? null : <EmptyDescription>{description}</EmptyDescription>}
    </EmptyHeader>
    {action === undefined ? null : <EmptyContent className="items-start">{action}</EmptyContent>}
  </Empty>
);
