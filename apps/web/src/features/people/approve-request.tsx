import { useRef, useState } from "react";

import { ActDialog } from "@/shared/act-dialog.tsx";
import { Button } from "@/shared/ui/button.tsx";

import type { Role } from "./people-api.ts";
import { requesterName, type WaitingRequest } from "./requests-api.ts";
import { ROLE_OFFERED_FIRST, RoleChoice } from "./role-choice.tsx";

/**
 * No Radix trigger opened it, so the opener puts focus back, told whether the approval went: a
 * sent one takes its row away.
 */
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
    <ActDialog
      open
      onOpenChange={(open) => {
        if (!open) properties.onClose();
      }}
      content={{
        className: "wrap-anywhere",
        onCloseAutoFocus: (event) => {
          event.preventDefault();
          properties.onFocusBack(sent.current);
        },
      }}
      title={`Approve the request from ${requesterName(request)}`}
      consequence={`Approving emails ${request.requester.email} an invitation to join this workspace at the role below. It lasts seven days, and they become a member when they accept it.`}
      commit={
        <Button
          onClick={() => {
            sent.current = true;
            properties.onApprove(role);
          }}
        >
          Approve and send the invitation
        </Button>
      }
    >
      <RoleChoice role={role} onChoose={setRole} />
    </ActDialog>
  );
}
