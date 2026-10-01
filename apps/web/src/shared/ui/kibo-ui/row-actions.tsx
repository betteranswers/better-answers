import { DotsThreeVertical } from "@phosphor-icons/react";

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

const itemOf = (action: RowAction) => (
  <DropdownMenuItem
    key={action.label}
    variant={action.destructive === true ? "destructive" : "default"}
    onSelect={action.onSelect}
  >
    {action.label}
  </DropdownMenuItem>
);

/** A destructive act sits apart, below the rest and one separator, whatever order a caller lists. */
export const RowActions = ({ label, actions }: RowActionsProps) => {
  const rest = actions.filter((action) => action.destructive !== true);
  const destructive = actions.filter((action) => action.destructive === true);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="size-8" size="icon" variant="ghost" aria-label={label}>
          <DotsThreeVertical aria-hidden className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        {rest.map(itemOf)}
        {rest.length > 0 && destructive.length > 0 ? <DropdownMenuSeparator /> : null}
        {destructive.map(itemOf)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
