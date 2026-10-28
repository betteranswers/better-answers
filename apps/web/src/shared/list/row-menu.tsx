import { RowActions, type RowAction } from "@/shared/ui/kibo-ui/row-actions.tsx";

export function RowMenu(properties: {
  readonly name: string;
  readonly actions: readonly RowAction[];
  readonly triggerId?: string | undefined;
}) {
  return (
    <RowActions
      label={`Actions for ${properties.name}`}
      actions={properties.actions}
      triggerId={properties.triggerId}
    />
  );
}
