import { emailPage, PARAGRAPH } from "../email-page.ts";
import type { EmailMessage } from "../email.ts";
import { PRODUCT_NAME } from "../product-name.ts";

const WORDS = {
  subject: `Sign in to ${PRODUCT_NAME}`,
  codeFollows: `Your ${PRODUCT_NAME} sign-in code:`,
  enterIt: "Enter it where you asked for it. It works for five minutes.",
  linkFollows: `Sign in to ${PRODUCT_NAME} with this link, in the browser where you asked:`,
  button: `Sign in to ${PRODUCT_NAME}`,
  orTheCode: "Or enter this code there:",
  bothWork: "The link and the code work once, for five minutes.",
  notAsked: "If you did not ask to sign in, ignore this email.",
} as const;

const CODE = `${PARAGRAPH};font:600 32px/1.2 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:4px`;
const BUTTON =
  "display:inline-block;padding:10px 18px;border-radius:6px;background:#2f6f4f;color:#ffffff;text-decoration:none;font-weight:600";

const page = (body: string): string => emailPage(WORDS.subject, body);

/** `code` is digits alone and `link` the api's own address and token, so nothing here needs escaping. */
const htmlOf = (code: string, link: string | undefined): string =>
  link === undefined
    ? page(`<p style="${PARAGRAPH}">${WORDS.codeFollows}</p>
<p style="${CODE}">${code}</p>
<p style="${PARAGRAPH}">${WORDS.enterIt}</p>
<p style="margin:0">${WORDS.notAsked}</p>`)
    : page(`<p style="${PARAGRAPH}"><a href="${link}" style="${BUTTON}">${WORDS.button}</a></p>
<p style="${PARAGRAPH}">${WORDS.orTheCode}</p>
<p style="${CODE}">${code}</p>
<p style="${PARAGRAPH}">${WORDS.bothWork}</p>
<p style="margin:0">${WORDS.notAsked}</p>`);

const textOf = (code: string, link: string | undefined): string =>
  (link === undefined
    ? [WORDS.codeFollows, "", code, "", WORDS.enterIt, "", WORDS.notAsked]
    : [
        WORDS.linkFollows,
        "",
        link,
        "",
        WORDS.orTheCode,
        "",
        code,
        "",
        WORDS.bothWork,
        "",
        WORDS.notAsked,
      ]
  ).join("\n");

/** The text part keeps the code and the link each on a line of its own, where a reader finds them. */
export const signInEmail = (to: string, code: string, link: string | undefined): EmailMessage => ({
  to,
  subject: WORDS.subject,
  text: textOf(code, link),
  html: htmlOf(code, link),
});
