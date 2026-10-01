import { DotsThreeVertical } from "@phosphor-icons/react";
import { Fragment } from "react";

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
};

export type RowActionsProps = {
  label: string;
  actions: readonly RowAction[];
};

/** A destructive act sits apart from the rest, below a separator. */
const startsTheDestructive = (actions: readonly RowAction[], index: number): boolean =>
  index > 0 && actions[index]?.destructive === true && actions[index - 1]?.destructive !== true;

export const RowActions = ({ label, actions }: RowActionsProps) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button className="size-8" size="icon" variant="ghost" aria-label={label}>
        <DotsThreeVertical aria-hidden className="size-4" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="min-w-40">
      {actions.map((action, index) => (
        <Fragment key={action.label}>
          {startsTheDestructive(actions, index) ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem
            variant={action.destructive === true ? "destructive" : "default"}
            onSelect={action.onSelect}
          >
            {action.label}
          </DropdownMenuItem>
        </Fragment>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
);
