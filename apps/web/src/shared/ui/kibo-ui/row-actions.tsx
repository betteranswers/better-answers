import { DotsThreeVertical } from "@phosphor-icons/react";
import { useRef } from "react";

import { Button } from "@/shared/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu.tsx";

export type RowAction = {
  label: string;
  onSelect: () => void;
  destructive?: boolean | undefined;
  /** Where focus goes once the menu has shut, for an act that takes its row away. */
  focusAfter?: (() => HTMLElement | null) | undefined;
};

export type RowActionsProps = {
  label: string;
  actions: readonly RowAction[];
};

/** A destructive act sits apart, below the rest and one separator, whatever order a caller lists. */
export const RowActions = ({ label, actions }: RowActionsProps) => {
  // The open menu holds focus inside it, so an act's own focus lands only once it has shut.
  const chosen = useRef<RowAction>(undefined);
  const rest = actions.filter((action) => action.destructive !== true);
  const destructive = actions.filter((action) => action.destructive === true);

  const itemOf = (action: RowAction) => (
    <DropdownMenuItem
      key={action.label}
      variant={action.destructive === true ? "destructive" : "default"}
      onSelect={() => {
        chosen.current = action;
        action.onSelect();
      }}
    >
      {action.label}
    </DropdownMenuItem>
  );

  const focusAfterShutting = (event: Event) => {
    const target = chosen.current?.focusAfter?.();
    chosen.current = undefined;
    if (target === undefined || target === null) return;
    event.preventDefault();
    target.focus();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="size-8" size="icon" variant="ghost" aria-label={label}>
          <DotsThreeVertical aria-hidden className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40" onCloseAutoFocus={focusAfterShutting}>
        {rest.map(itemOf)}
        {rest.length > 0 && destructive.length > 0 ? <DropdownMenuSeparator /> : null}
        {destructive.map(itemOf)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
