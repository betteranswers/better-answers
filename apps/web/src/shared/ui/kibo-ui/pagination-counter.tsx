import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/shared/lib/utils.ts";
import { Button } from "@/shared/ui/button.tsx";
import { Pagination, PaginationContent, PaginationItem } from "@/shared/ui/pagination.tsx";

export type PaginationTurnProps = {
  label: string;
  disabled: boolean;
  keystroke?: string | undefined;
  onTurn: () => void;
};

const PaginationTurn = ({
  label,
  disabled,
  keystroke,
  onTurn,
  children,
}: PaginationTurnProps & { children: ReactNode }) => (
  <Button
    type="button"
    variant="outline"
    size="sm"
    aria-label={label}
    aria-disabled={disabled}
    aria-keyshortcuts={keystroke}
    className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
    onClick={() => {
      if (!disabled) onTurn();
    }}
  >
    {children}
  </Button>
);

export type PaginationCounterProps = ComponentProps<typeof Pagination> & {
  summary?: ReactNode;
  counter: ReactNode;
  previous: PaginationTurnProps;
  next: PaginationTurnProps;
};

export const PaginationCounter = ({
  summary,
  counter,
  previous,
  next,
  className,
  ...props
}: PaginationCounterProps) => (
  <Pagination
    className={cn("flex-wrap items-center justify-between gap-x-4 gap-y-2", className)}
    {...props}
  >
    {summary === undefined ? null : (
      <p role="status" className="text-sm text-muted-foreground tabular-nums">
        {summary}
      </p>
    )}
    <PaginationContent className="flex-wrap gap-2">
      <PaginationItem>
        <PaginationTurn {...previous}>
          <CaretLeftIcon aria-hidden />
          Previous
        </PaginationTurn>
      </PaginationItem>
      <PaginationItem>
        <span
          role={summary === undefined ? "status" : undefined}
          className="text-sm text-muted-foreground tabular-nums"
        >
          {counter}
        </span>
      </PaginationItem>
      <PaginationItem>
        <PaginationTurn {...next}>
          Next
          <CaretRightIcon aria-hidden />
        </PaginationTurn>
      </PaginationItem>
    </PaginationContent>
  </Pagination>
);
