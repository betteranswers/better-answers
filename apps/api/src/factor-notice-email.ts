import type { Logger } from "pino";

import { attempt } from "@better-answers/core/kernel";

import { emailPage, PARAGRAPH } from "./email-page.ts";
import type { EmailMessage, Mail } from "./email.ts";
import { PRODUCT_NAME } from "./product-name.ts";

/** The SPA's Account page, where a person sees and changes their own second factor. */
const ACCOUNT_PATH = "/account";

export type FactorChange = "authenticator-added" | "authenticator-removed" | "codes-replaced";

const CHANGES = {
  "authenticator-added": {
    subject: `An authenticator now confirms your ${PRODUCT_NAME} sign-in`,
    happened: "An authenticator was set up as your second factor.",
  },
  "authenticator-removed": {
    subject: `Your ${PRODUCT_NAME} authenticator was removed`,
    happened: "Your authenticator was removed, so it no longer confirms your sign-in.",
  },
  "codes-replaced": {
    subject: `Your ${PRODUCT_NAME} recovery codes were replaced`,
    happened: "New recovery codes were made, and your earlier ones no longer work.",
  },
} as const satisfies Record<FactorChange, { subject: string; happened: string }>;

const WORDS = {
  ifYou: "If you made this change, there is nothing more to do.",
  ifNot:
    "If you didn't, sign in and check your Account page now, then tell the platform's operator:",
} as const;

/** Every value is a fixed phrase or the api's own address, so nothing here needs escaping. */
const htmlOf = (happened: string, subject: string, account: string): string =>
  emailPage(
    subject,
    `<p style="${PARAGRAPH}">${happened}</p>
<p style="${PARAGRAPH}">${WORDS.ifYou}</p>
<p style="${PARAGRAPH}">${WORDS.ifNot}</p>
<p style="margin:0"><a href="${account}">${account}</a></p>`,
  );

/** Names what changed and never the factor itself: no key, no code, no device. */
const factorNoticeEmail = (to: string, change: FactorChange, publicUrl: string): EmailMessage => {
  const { subject, happened } = CHANGES[change];
  const account = `${publicUrl}${ACCOUNT_PATH}`;
  return {
    to,
    subject,
    text: [happened, "", WORDS.ifYou, "", WORDS.ifNot, "", account].join("\n"),
    html: htmlOf(happened, subject, account),
  };
};

/** A missed notice is a log line: the change stands on the identity-set audit log all the same. */
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
