import { OAUTH_SCOPES, type OAuthScope, SIGN_IN_PATH } from "./constants.ts";

const escape = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const strong = (value: string): string => `<strong>${escape(value)}</strong>`;

/** The consent page's words. The page's body passes each value in escaped and marked up. */
export const CONSENT_WORDS = {
  title: (client: string) => `Connect ${client}`,
  actsAs: (client: string, workspace: string) => `${client} will act as you, at ${workspace}.`,
  hostedAt: (client: string, host: string) =>
    `This app calls itself “${client}” and is hosted at ${host}.`,
  goesNext: (host: string) => `If you did not expect Connect to take you to ${host}, cancel.`,
  scopes: {
    "knowledge:read": "Read what you can see of the company's knowledge",
    "feedback:write": "Send your feedback on answers",
    offline_access: "Stay connected until you disconnect it, without signing in each time",
  } satisfies Record<OAuthScope, string>,
  recorded: (client: string) =>
    `Every question you ask through ${client} is recorded as asked by you.`,
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
    why: "This form can only be sent from Better Answers.",
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

const shell = (title: string, body: string): string => `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)} — Better Answers</title><style>
:root{color-scheme:light dark}
body{font:16px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif;max-width:34rem;margin:6vh auto;padding:0 1.5rem}
h1{font-size:1.35rem;margin:0 0 .25rem}p{margin:.6rem 0}
button{margin-top:1.1rem;padding:.6rem 1.1rem;font:inherit;border:0;border-radius:.4rem;background:#2f6f4f;color:#fff;cursor:pointer}
button.secondary{background:transparent;color:inherit;border:1px solid #8888}
ul{padding-left:1.1rem}.muted{opacity:.7;font-size:.9rem}
form.inline{display:inline}
</style></head><body><main>${body}</main></body></html>`;

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
  const client = escape(params.clientName);
  const granted = OAUTH_SCOPES.filter((scope) => params.scopes.includes(scope));
  return shell(
    CONSENT_WORDS.title(params.clientName),
    `<h1>${CONSENT_WORDS.title(client)}</h1>
<p>${CONSENT_WORDS.actsAs(client, strong(params.workspace))}</p>
<p>${CONSENT_WORDS.hostedAt(client, strong(params.hostedAt))}</p>
<p>${CONSENT_WORDS.goesNext(strong(params.sendsCodeTo))}</p>
<ul>
  ${granted.map((scope) => `<li>${escape(CONSENT_WORDS.scopes[scope])}</li>`).join("\n  ")}
</ul>
<p>${CONSENT_WORDS.recorded(client)}</p>
<form method="post" action="/consent${escape(query)}" class="inline">
  <input type="hidden" name="accept" value="true"><button type="submit">${CONSENT_WORDS.connect}</button>
</form>
<form method="post" action="/consent${escape(query)}" class="inline">
  <input type="hidden" name="accept" value="false"><button type="submit" class="secondary">${CONSENT_WORDS.cancel}</button>
</form>`,
  );
};

const refusal = (words: RefusalWords, next: string): string =>
  shell(words.title, `<h1>${escape(words.title)}</h1><p>${escape(words.why)}</p><p>${next}</p>`);

export const refusedPage = (words: ReadNext): string => refusal(words, escape(words.next));

/** `query` is the signed search string, leading `?` included: sign-in carries it back here. */
export const signInPage = (words: SignInNext, query: string): string =>
  refusal(words, `<a href="${escape(`${SIGN_IN_PATH}${query}`)}">${escape(words.signIn)}</a>`);
