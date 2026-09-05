/**
 * The one page of the OAuth flow this tier still renders — consent — served from Hono,
 * plain and server-rendered (grilling Q5, 2026-09-01), and the refusal page beside it.
 * Sign-in and the workspace picker left with T-037: they are the SPA's screens now
 * (ADR 0009, 2026-09-02), and consent stays here because a decision to grant an outside
 * client access to a workspace must never sit behind the product's own shell. The
 * wording is ADR 0018's, in the person's words. Native controls, labels and a `main`
 * landmark: what WCAG 2.2 AA asks of every screen.
 */

const escape = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

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

export const consentPage = (
  query: string,
  params: {
    readonly clientName: string;
    /** The `client_id` URL's hostname — the one name its author cannot choose. */
    readonly hostedAt: string;
    /** The `redirect_uri` hostname the authorization code will be sent to. */
    readonly sendsCodeTo: string;
    readonly workspace: string;
    readonly scopes: readonly string[];
  },
): string =>
  shell(
    `Connect ${params.clientName}`,
    `<h1>Connect ${escape(params.clientName)}</h1>
<p>${escape(params.clientName)} will act as you, at <strong>${escape(params.workspace)}</strong>.</p>
<p>This app calls itself “${escape(params.clientName)}”. It is hosted at <strong>${escape(params.hostedAt)}</strong> and your connection will be sent to <strong>${escape(params.sendsCodeTo)}</strong>. If you did not expect those addresses, cancel.</p>
<ul>
  ${params.scopes.includes("knowledge:read") ? "<li>Read what you can see of the company's knowledge</li>" : ""}
  ${params.scopes.includes("feedback:write") ? "<li>Send your feedback on answers</li>" : ""}
  ${params.scopes.includes("offline_access") ? "<li>Stay connected until you disconnect it, without signing in each time</li>" : ""}
</ul>
<p>Every question you ask through ${escape(params.clientName)} is recorded as asked by you.</p>
<form method="post" action="/consent${escape(query)}" class="inline">
  <input type="hidden" name="accept" value="true"><button type="submit">Connect</button>
</form>
<form method="post" action="/consent${escape(query)}" class="inline">
  <input type="hidden" name="accept" value="false"><button type="submit" class="secondary">Cancel</button>
</form>`,
  );

export const refusedPage = (title: string, message: string): string =>
  shell(title, `<h1>${escape(title)}</h1><p>${escape(message)}</p>`);
