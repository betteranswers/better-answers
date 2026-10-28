import {
  restoreSignIn,
  setOperatorMark,
  type SignInRestored,
} from "@better-answers/core/workspaces";

import type { Doors } from "../doors.ts";
import { sendFactorNotice } from "../email/factor-notice-email.ts";
import { IDENTITY_PRINCIPAL } from "../identity-principal.ts";
import { DONE, REFUSED, USAGE, type OpsIo, type Flags, flagValue, exitOf } from "./cli.ts";
import { notSignedIn } from "./workspaces.ts";

const OPERATOR_USAGE = "operator: --email <email> and one of --grant or --revoke are required";

const MARK_SAID = {
  grant: { changed: "is the operator", unchanged: "was already the operator; nothing written" },
  revoke: {
    changed: "is no longer the operator",
    unchanged: "was not the operator; nothing written",
  },
} as const;

export const operatorCommand = async (doors: Doors, flags: Flags, io: OpsIo): Promise<number> => {
  const email = flagValue(flags, "email");
  const granting = flags.has("grant");
  if (email === undefined || granting === flags.has("revoke")) {
    io.say(OPERATOR_USAGE);
    return USAGE;
  }
  const change = granting ? "grant" : "revoke";
  const marked = await setOperatorMark(IDENTITY_PRINCIPAL, doors.postgres, { email, change });
  if (!marked.ok) {
    const reason = marked.error === "no-such-user" ? notSignedIn(email) : marked.error.message;
    io.say(`operator: REFUSED — ${reason}`);
    return exitOf(marked.error);
  }
  const said = MARK_SAID[change][marked.value.changed ? "changed" : "unchanged"];
  io.say(`operator: done — ${email} ${said}`);
  return DONE;
};

const RESTORE_USAGE = "restore-sign-in: --email <email> is required";

const NO_MAIL =
  "no email transport is configured (SMTP_URL on the api service), so the restore notice cannot go; nothing changed";

const restoredSaid = (restored: SignInRestored, noticed: boolean): readonly string[] => [
  `restore-sign-in: done — ${restored.email} holds no passkey, authenticator or recovery code now, and every session of theirs is signed out`,
  noticed
    ? `restore-sign-in: a notice of the restore went to ${restored.email}`
    : `restore-sign-in: the notice to ${restored.email} did not go; tell them of the restore yourself`,
  `restore-sign-in: their restore code, good once until ${restored.expiresAt.toISOString()}: ${restored.code}`,
  "restore-sign-in: run this only once you have checked who they are by a channel other than their email, and hand them the code by that same channel, never by email",
];

export const restoreSignInCommand = async (
  doors: Doors,
  flags: Flags,
  io: OpsIo,
): Promise<number> => {
  const email = flagValue(flags, "email");
  if (email === undefined) {
    io.say(RESTORE_USAGE);
    return USAGE;
  }
  if (io.mail === undefined) {
    io.say(`restore-sign-in: REFUSED — ${NO_MAIL}`);
    return REFUSED;
  }
  const restored = await restoreSignIn(IDENTITY_PRINCIPAL, doors.postgres, {
    email,
    now: doors.clock.now(),
  });
  if (!restored.ok) {
    const reason =
      restored.error === "no-such-user"
        ? `no-such-user: ${email} is no one's address here; nothing changed`
        : restored.error.message;
    io.say(`restore-sign-in: REFUSED — ${reason}`);
    return exitOf(restored.error);
  }
  const noticed = await sendFactorNotice(
    { mail: io.mail, log: io.logger },
    restored.value.email,
    "sign-in-restored",
  );
  for (const line of restoredSaid(restored.value, noticed)) io.say(line);
  return DONE;
};
