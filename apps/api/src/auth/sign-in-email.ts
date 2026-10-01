import type { EmailMessage } from "../email.ts";
import { PRODUCT_NAME } from "../product-name.ts";

const WORDS = {
  subject: `Sign in to ${PRODUCT_NAME}`,
  codeFollows: `Your ${PRODUCT_NAME} sign-in code:`,
  enterIt: "Enter it where you asked for it. It works for five minutes.",
  notAsked: "If you did not ask to sign in, ignore this email.",
} as const;

const PARAGRAPH = "margin:0 0 16px";
const CODE = `${PARAGRAPH};font:600 32px/1.2 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:4px`;

/** `code` is digits alone, and every other value is ours, so nothing here needs escaping. */
const htmlOf = (code: string): string => `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${WORDS.subject}</title></head>
<body style="margin:0;padding:24px;font:16px/1.5 -apple-system,'Segoe UI',system-ui,sans-serif">
<p style="${PARAGRAPH}">${WORDS.codeFollows}</p>
<p style="${CODE}">${code}</p>
<p style="${PARAGRAPH}">${WORDS.enterIt}</p>
<p style="margin:0">${WORDS.notAsked}</p>
</body></html>`;

/** The text part keeps the code on a line of its own, where a reader of the email finds it. */
export const signInEmail = (to: string, code: string): EmailMessage => ({
  to,
  subject: WORDS.subject,
  text: [WORDS.codeFollows, "", code, "", WORDS.enterIt, "", WORDS.notAsked].join("\n"),
  html: htmlOf(code),
});
