import { useId } from "react";

import { Label } from "@/shared/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select.tsx";

import type { Role } from "./people-api.ts";
import { ROLE_MEANINGS, ROLES, roleOf } from "./role-meanings.ts";

/** The least a new person is offered, so a slip never hands out more than asking. */
export const ROLE_OFFERED_FIRST: Role = "Viewer";

/** The role a person joins at, what it lets them do said beside it. */
export function RoleChoice(properties: {
  readonly role: Role;
  readonly onChoose: (role: Role) => void;
}) {
  const ids = { role: useId(), meaning: useId() };

  return (
    <div className="grid gap-2">
      <Label htmlFor={ids.role}>Role</Label>
      <Select
        value={properties.role}
        onValueChange={(chosen) => {
          properties.onChoose(roleOf(chosen) ?? ROLE_OFFERED_FIRST);
        }}
      >
        <SelectTrigger id={ids.role} aria-describedby={ids.meaning}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ROLES.map((word) => (
            <SelectItem key={word} value={word}>
              {word}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p id={ids.meaning} className="text-sm text-muted-foreground">
        {ROLE_MEANINGS[properties.role]}
      </p>
    </div>
  );
}
