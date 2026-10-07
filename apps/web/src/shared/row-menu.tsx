import { RowActions, type RowAction } from "@/shared/ui/kibo-ui/row-actions.tsx";

/** Every row's trigger looks alike, so its name says whose actions these are. */
export function RowMenu(properties: {
  readonly name: string;
  readonly actions: readonly RowAction[];
}) {
  return <RowActions label={`Actions for ${properties.name}`} actions={properties.actions} />;
}
