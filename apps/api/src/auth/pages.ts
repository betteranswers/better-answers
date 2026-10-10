import { readFileSync } from "node:fs";

import { escaped } from "../email-page.ts";
import { PRODUCT_NAME } from "../product-name.ts";
import { OAUTH_SCOPES, type OAuthScope, SIGN_IN_PATH } from "./constants.ts";
import { PAGE_STYLE } from "./page-style.ts";

/** Inline rather than linked, so its `currentColor` is the page's text colour, light or dark. */
const LOGO = readFileSync(
  new URL(import.meta.resolve("@better-answers/design-system/assets/logo.svg")),
  "utf8",
).trim();

const strong = (value: string): string => `<strong>${escaped(value)}</strong>`;

/** The consent page's words. The page's body passes each value in escaped and marked up. */
export const CONSENT_WORDS = {
  title: (assistant: string) => `Connect ${assistant}`,
  asYou: (assistant: string, workspace: string) => `${assistant} will act as you, at ${workspace}.`,
  hostedAt: (assistant: string, host: string) =>
    `This app calls itself “${assistant}” and is hosted at ${host}.`,
  goesNext: (host: string) => `If you did not expect Connect to take you to ${host}, cancel.`,
  scopes: {
    "knowledge:read": "Read what you can see of the company’s knowledge",
    "feedback:write": "Send your feedback on answers",
    offline_access: "Stay connected until you disconnect it, without signing in each time",
  } satisfies Record<OAuthScope, string>,
  recorded: (assistant: string) =>
    `Every question you ask through ${assistant} is recorded as asked by you.`,
  connect: "Connect",
  cancel: "Cancel",
} as const;

type RefusalWords = { readonly title: string; readonly why: string };

/** A refusal whose last line says what to do. */
type ReadNext = RefusalWords & { readonly next: string };

/** A refusal whose last line is a link to sign in, labelled `signIn`. */
type SignInNext = RefusalWords & { readonly signIn: string };

const START_AGAIN = "Start the connection again from where you began it.";

export const REFUSAL_PAGES = {
  crossSite: {
    title: "Nothing was connected",
    why: `This form can only be sent from ${PRODUCT_NAME}.`,
    next: START_AGAIN,
  },
  notNavigated: {
    title: "Nothing was connected",
    why: "The form was not sent from this page.",
    next: START_AGAIN,
  },
  notCompleted: {
    title: "Nothing was connected",
    why: "The connection could not be finished.",
    next: START_AGAIN,
  },
  signInFirst: {
    title: "Sign in first",
    why: "You are not signed in to a workspace yet.",
    signIn: "Sign in and carry on",
  },
  sessionEnded: {
    title: "Sign in again",
    why: "Your session has ended, so nothing was connected.",
    signIn: "Sign in and come back to connect",
  },
} as const satisfies Record<string, ReadNext | SignInNext>;

/** The sign-in pages' frame: one marked card on the grid. The card's marks stand for its primary button's. */
const shell = (title: string, body: string): string => `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escaped(title)} — ${PRODUCT_NAME}</title><style>${PAGE_STYLE}</style></head>
<body data-grid-pattern><header><span aria-hidden="true">${LOGO}</span>${PRODUCT_NAME}</header>
<main id="page"><div data-slot="card" data-marks><div data-slot="card-header"><h1>${escaped(title)}</h1></div>
<div data-slot="card-content">${body}</div></div></main></body></html>`;

/** `query` is the signed search string, leading `?` included. Every value is escaped here. */
export const consentPage = (
  query: string,
  params: {
    readonly clientName: string;

    readonly hostedAt: string;

    readonly sendsCodeTo: string;
    readonly workspace: string;
    readonly scopes: readonly string[];
  },
): string => {
  const assistant = escaped(params.clientName);
  const granted = OAUTH_SCOPES.filter((scope) => params.scopes.includes(scope));
  return shell(
    CONSENT_WORDS.title(params.clientName),
    `<p>${CONSENT_WORDS.asYou(assistant, strong(params.workspace))}</p>
<p>${CONSENT_WORDS.hostedAt(assistant, strong(params.hostedAt))}</p>
<p>${CONSENT_WORDS.goesNext(strong(params.sendsCodeTo))}</p>
<ul>
  ${granted.map((scope) => `<li>${escaped(CONSENT_WORDS.scopes[scope])}</li>`).join("\n  ")}
</ul>
<p>${CONSENT_WORDS.recorded(assistant)}</p>
<div data-slot="actions">
<form method="post" action="/consent${escaped(query)}">
  <input type="hidden" name="accept" value="true"><button type="submit" data-variant="default" data-marks>${CONSENT_WORDS.connect}</button>
</form>
<form method="post" action="/consent${escaped(query)}">
  <input type="hidden" name="accept" value="false"><button type="submit" data-variant="outline">${CONSENT_WORDS.cancel}</button>
</form>
</div>`,
  );
};

const refusal = (words: RefusalWords, next: string): string =>
  shell(words.title, `<p>${escaped(words.why)}</p><p>${next}</p>`);

export const refusedPage = (words: ReadNext): string => refusal(words, escaped(words.next));

/** `query` is the signed search string, leading `?` included: sign-in carries it back here. */
export const signInPage = (words: SignInNext, query: string): string =>
  refusal(words, `<a href="${escaped(`${SIGN_IN_PATH}${query}`)}">${escaped(words.signIn)}</a>`);
