import type { Logger } from "pino";

import { attempt } from "@better-answers/core/kernel";
import type { RaisedFlag } from "@better-answers/core/members";

import type { EmailMessage, Mail } from "../email.ts";

const nameFlagEmail = (operatorAddress: string, raised: RaisedFlag): EmailMessage => ({
  to: operatorAddress,
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

/** A missed email loses no flag: it stands on the identity-set audit log, and the answer is unmoved. */
export const tellTheOperator = async (
  ctx: { readonly mail: Mail; readonly log: Logger },
  raised: RaisedFlag,
): Promise<void> => {
  const { mail, log } = ctx;
  const facts = { event: "trpc.email_failed", person_id: raised.personId };
  if (mail.operatorAddress === undefined) {
    log.error(facts, "no operator address is configured, so the name flag was not emailed");
    return;
  }
  const { operatorAddress } = mail;
  const sent = await attempt(() => mail.send(nameFlagEmail(operatorAddress, raised)));
  // The error is the relay's, which may quote the name; the person id is enough to find it.
  if (!sent.ok) log.warn(facts, "the name flag's email to the operator did not go");
};
