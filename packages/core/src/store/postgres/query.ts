import type { OperatorPrincipal, Principal } from "../../kernel/index.ts";

export const scopeClause = (at: number): string =>
  `COALESCE($${at}::text, (select current_workspace_id()))`;

export const scopeParameter = (principal: Principal | OperatorPrincipal): string | null =>
  principal.kind === "user" ? principal.workspaceId : null;

type Bindable = string | number | Date | null | readonly string[];

export const boundValues = () => {
  const values: Bindable[] = [];
  return { values, bind: (value: Bindable): number => values.push(value) };
};

export type Bind = ReturnType<typeof boundValues>["bind"];

export const containing = (text: string): string =>
  `%${text.replaceAll(/[\\%_]/gu, String.raw`\$&`)}%`;
