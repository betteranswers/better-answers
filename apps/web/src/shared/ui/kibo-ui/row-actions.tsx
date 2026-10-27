import { DotsThreeVerticalIcon } from "@phosphor-icons/react";
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
  focusAfter?: (() => HTMLElement | null) | undefined;
};

export type RowActionsProps = {
  label: string;
  actions: readonly RowAction[];
  triggerId?: string | undefined;
};

export const RowActions = ({ label, actions, triggerId }: RowActionsProps) => {
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
        <Button id={triggerId} className="size-8" size="icon" variant="ghost" aria-label={label}>
          <DotsThreeVerticalIcon aria-hidden className="size-4" />
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
