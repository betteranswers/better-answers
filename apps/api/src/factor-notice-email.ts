import type { Logger } from "pino";

import { attempt } from "@better-answers/core/kernel";

import { emailPage, PARAGRAPH } from "./email-page.ts";
import type { EmailMessage, Mail } from "./email.ts";
import { PRODUCT_NAME } from "./product-name.ts";

/** The SPA's Account page, where a person sees and changes their own second factor. */
const ACCOUNT_PATH = "/account";

export type FactorChange =
  | "passkey-added"
  | "passkey-removed"
  | "authenticator-added"
  | "authenticator-removed"
  | "codes-made"
  | "codes-replaced"
  | "recovery-code-used"
  | "factors-replaced"
  | "confirm-failures";

type Change = {
  readonly subject: string;
  readonly happened: string;

  /** Said in place of the usual line, for a notice of something the person may not have done. */
  readonly ifYou?: string;
};

const CHANGES = {
  "passkey-added": {
    subject: `A passkey was added to your ${PRODUCT_NAME} account`,
    happened: "A passkey was added to your account. It signs you in with no email.",
  },
  "passkey-removed": {
    subject: `A passkey was removed from your ${PRODUCT_NAME} account`,
    happened: "A passkey was removed from your account, so it no longer signs you in.",
  },
  "authenticator-added": {
    subject: `An authenticator was set up on your ${PRODUCT_NAME} account`,
    happened: "An authenticator was set up as your second factor.",
  },
  "authenticator-removed": {
    subject: `Your ${PRODUCT_NAME} authenticator was removed`,
    happened: "Your authenticator was removed from your account.",
  },
  "codes-made": {
    subject: `Recovery codes were made for your ${PRODUCT_NAME} account`,
    happened: "Ten recovery codes were made for your account. Each signs you in once.",
  },
  "codes-replaced": {
    subject: `Your ${PRODUCT_NAME} recovery codes were replaced`,
    happened: "New recovery codes were made, and your earlier ones no longer work.",
  },
  "recovery-code-used": {
    subject: `A recovery code was used on your ${PRODUCT_NAME} account`,
    happened:
      "One of your recovery codes was used in place of your second factor. It no longer works.",
  },
  "factors-replaced": {
    subject: `Your ${PRODUCT_NAME} second factor was replaced`,
    happened:
      "Your second factor was replaced. Your earlier passkeys and authenticator no longer work, and new recovery codes were made.",
  },
  "confirm-failures": {
    subject: `Wrong codes were entered for your ${PRODUCT_NAME} account`,
    happened:
      "Several wrong codes in a row were entered to confirm your second factor. Each further wrong code makes the next try wait longer.",
    ifYou: "If they were yours, there is nothing more to do.",
  },
} as const satisfies Record<FactorChange, Change>;

const WORDS = {
  ifYou: "If you made this change, there is nothing more to do.",
  ifNot:
    "If you didn't, sign in and check your Account page now, then tell the platform's operator:",
} as const;

/** Every value is a fixed phrase or the api's own address, so nothing here needs escaping. */
const htmlOf = (change: Required<Change>, account: string): string =>
  emailPage(
    change.subject,
    `<p style="${PARAGRAPH}">${change.happened}</p>
<p style="${PARAGRAPH}">${change.ifYou}</p>
<p style="${PARAGRAPH}">${WORDS.ifNot}</p>
<p style="margin:0"><a href="${account}">${account}</a></p>`,
  );

/** Names what changed and never the factor itself: no key, no code, no device. */
const factorNoticeEmail = (to: string, change: FactorChange, publicUrl: string): EmailMessage => {
  const said: Required<Change> = { ifYou: WORDS.ifYou, ...CHANGES[change] };
  const account = `${publicUrl}${ACCOUNT_PATH}`;
  return {
    to,
    subject: said.subject,
    text: [said.happened, "", said.ifYou, "", WORDS.ifNot, "", account].join("\n"),
    html: htmlOf(said, account),
  };
};

/**
 * Never rejects, so a caller need not await it and a slow relay holds no answer. A missed notice
 * is a log line.
 */
export const sendFactorNotice = async (
  ctx: { readonly mail: Mail; readonly log: Logger },
  to: string,
  change: FactorChange,
): Promise<void> => {
  const sent = await attempt(() =>
    ctx.mail.send(factorNoticeEmail(to, change, ctx.mail.publicUrl)),
  );
  if (!sent.ok) {
    ctx.log.warn(
      { event: "auth.factor_notice_failed", change },
      "a second-factor notice did not go",
    );
  }
};
