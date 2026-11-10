import { useRef, useState } from "react";

import { MountedActionDialog } from "@/shared/page/action-dialog.tsx";
import { Button } from "@/shared/ui/button.tsx";

import { REQUEST_WORDS } from "../invitation-words.ts";
import type { Role } from "../people-api.ts";
import { ROLE_OFFERED_FIRST, RoleChoice } from "../role-choice.tsx";
import { requesterName, type WaitingRequest } from "./requests-api.ts";

export function ApproveRequest(properties: {
  readonly request: WaitingRequest;
  readonly onApprove: (role: Role) => void;
  readonly onClose: () => void;
  readonly onFocusBack: (sent: boolean) => void;
}) {
  const { request } = properties;
  const [role, setRole] = useState<Role>(ROLE_OFFERED_FIRST);
  const sent = useRef(false);

  return (
    <MountedActionDialog
      onClose={properties.onClose}
      onFocusBack={() => {
        properties.onFocusBack(sent.current);
      }}
      title={REQUEST_WORDS.approveFrom(requesterName(request))}
      consequence={REQUEST_WORDS.approveConsequence(request.requester.email)}
      commit={
        <Button
          onClick={() => {
            sent.current = true;
            properties.onApprove(role);
          }}
        >
          Approve
        </Button>
      }
    >
      <RoleChoice role={role} onChoose={setRole} />
    </MountedActionDialog>
  );
}
