import { RowActions, type RowAction } from "@/shared/ui/kibo-ui/row-actions.tsx";

/** Every row's trigger looks alike, so its name says whose acts these are. */
export function RowMenu(properties: {
  readonly name: string;
  readonly acts: readonly RowAction[];
}) {
  return <RowActions label={`Acts for ${properties.name}`} actions={properties.acts} />;
}
