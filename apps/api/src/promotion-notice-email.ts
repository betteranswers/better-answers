import type { Logger } from "pino";

import { attempt } from "@better-answers/core/kernel";
import type { PostgresDoor } from "@better-answers/core/store/postgres";
import { type CredentialsHeld, readCredentialsHeld } from "@better-answers/core/workspaces";

import { emailPage, escaped, LONG_UK_DATE, PARAGRAPH } from "./email-page.ts";
import type { EmailMessage, Mail } from "./email.ts";
import { IDENTITY_PRINCIPAL } from "./identity-principal.ts";
import { PRODUCT_NAME } from "./product-name.ts";

/** The SPA's Account page, where a person removes a passkey or authenticator that is not theirs. */
const ACCOUNT_PATH = "/account";

const WORDS = {
  subject: `You're now an Admin on ${PRODUCT_NAME}`,
  heldSome: "You've just been made an Admin. These can confirm your sign-in:",
  heldNone:
    "You've just been made an Admin. You hold no passkey or authenticator yet, so you'll set one up before your next page.",
  check: `If one isn't yours, confirm with one that is, then remove it on your Account page. If none is, sign out and ask ${PRODUCT_NAME} support to restore your sign-in.`,
  passkey: "Passkey",
  unnamed: "Unnamed",
  authenticator: "Authenticator",
} as const;

/** The plugin keeps no date for an authenticator, so its line names it alone. */
const linesOf = (held: CredentialsHeld): readonly string[] => [
  ...held.passkeys.map(
    (passkey) =>
      `${WORDS.passkey} · ${passkey.name ?? WORDS.unnamed} · added ${LONG_UK_DATE.format(new Date(passkey.createdAt))}`,
  ),
  ...(held.authenticator ? [WORDS.authenticator] : []),
];

const heldHtml = (lines: readonly string[]): string =>
  lines.length === 0
    ? `<p style="${PARAGRAPH}">${escaped(WORDS.heldNone)}</p>`
    : `<p style="${PARAGRAPH}">${escaped(WORDS.heldSome)}</p>
<ul style="${PARAGRAPH}">${lines.map((line) => `<li>${escaped(line)}</li>`).join("")}</ul>
<p style="${PARAGRAPH}">${escaped(WORDS.check)}</p>`;

const htmlOf = (lines: readonly string[], account: string): string =>
  emailPage(
    WORDS.subject,
    `${heldHtml(lines)}
<p style="margin:0"><a href="${account}">${account}</a></p>`,
  );

/** Lists every credential by name and date, as the confirm page does; never a key or a code. */
const promotionNoticeEmail = (held: CredentialsHeld, publicUrl: string): EmailMessage => {
  const lines = linesOf(held);
  const account = `${publicUrl}${ACCOUNT_PATH}`;
  const text =
    lines.length === 0
      ? [WORDS.heldNone, "", account]
      : [WORDS.heldSome, "", ...lines, "", WORDS.check, "", account];
  return {
    to: held.address,
    subject: WORDS.subject,
    text: text.join("\n"),
    html: htmlOf(lines, account),
  };
};

/** Never rejects, so a caller need not await it; a missed notice is a log line, never a refused promotion. */
export const sendPromotionNotice = async (
  ctx: {
    readonly mail: Mail;
    readonly log: Logger;
    readonly doors: { readonly postgres: PostgresDoor };
  },
  personId: string,
): Promise<boolean> => {
  const held = await readCredentialsHeld(IDENTITY_PRINCIPAL, ctx.doors.postgres, { personId });
  const sent = held.ok
    ? await attempt(() => ctx.mail.send(promotionNoticeEmail(held.value, ctx.mail.publicUrl)))
    : held;
  if (!sent.ok) {
    ctx.log.warn({ event: "auth.promotion_notice_failed" }, "a promotion notice did not go");
  }
  return sent.ok;
};
