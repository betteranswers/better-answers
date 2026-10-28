import type { Logger } from "pino";

import { attempt } from "@better-answers/core/kernel";
import type { RaisedFlag } from "@better-answers/core/members";
import { operatorAddresses } from "@better-answers/core/workspaces";

import type { Doors } from "../doors.ts";
import type { EmailMessage, Mail } from "../email/email.ts";
import { IDENTITY_PRINCIPAL } from "../identity-principal.ts";

const nameFlagEmail = (to: string, raised: RaisedFlag): EmailMessage => ({
  to,
  subject: `A display name is flagged in ${raised.workspaceName}`,
  text: [
    `An Admin of ${raised.workspaceName} flagged a display name as inappropriate.`,
    "",
    `Workspace: ${raised.workspaceName} (${raised.workspaceId})`,
    `Person: ${raised.personId}`,
    `Current display name: ${raised.displayName}`,
    "",
    "The name stands until it is corrected. No Admin can change it.",
  ].join("\n"),
});

export const tellTheOperator = async (
  ctx: { readonly doors: Doors; readonly mail: Mail; readonly log: Logger },
  raised: RaisedFlag,
): Promise<void> => {
  const { doors, mail, log } = ctx;
  const facts = { event: "trpc.email_failed", person_id: raised.personId };
  const addresses = await operatorAddresses(IDENTITY_PRINCIPAL, doors.postgres);
  if (!addresses.ok) {
    log.error(
      { ...facts, err: addresses.error },
      "the operator's address was not read, so the name flag was not emailed",
    );
    return;
  }
  if (addresses.value.length === 0) {
    log.error(facts, "no person carries the operator mark, so the name flag was not emailed");
    return;
  }
  await Promise.all(
    addresses.value.map(async (address) => {
      const sent = await attempt(() => mail.send(nameFlagEmail(address, raised)));
      if (!sent.ok) log.warn(facts, "the name flag's email to the operator did not go");
    }),
  );
};
