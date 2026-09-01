/**
 * The three pages the OAuth flow needs — sign-in by email code, the workspace picker,
 * consent — served from Hono, plain and server-rendered (grilling Q5, 2026-09-01), and
 * replaced by T-022's shell. The consent wording is ADR 0018's, in the person's words.
 * Native controls, labels and a `main` landmark: what `[A11Y1]` asks of every screen.
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
label{display:block;margin:.9rem 0 .2rem;font-weight:600;font-size:.9rem}
input{width:100%;padding:.6rem;font:inherit;border:1px solid #8888;border-radius:.4rem;background:transparent;color:inherit}
button{margin-top:1.1rem;padding:.6rem 1.1rem;font:inherit;border:0;border-radius:.4rem;background:#2f6f4f;color:#fff;cursor:pointer}
button.secondary{background:transparent;color:inherit;border:1px solid #8888}
ul{padding-left:1.1rem}.muted{opacity:.7;font-size:.9rem}.error{color:#b00020}
form.inline{display:inline}
</style></head><body><main>${body}</main></body></html>`;

/** Step one of sign-in: the address. */
export const signInPage = (query: string, notice?: string): string =>
  shell(
    "Sign in",
    `<h1>Sign in</h1>
<p>Enter your work email. We will send you a six-digit code.</p>
${notice === undefined ? "" : `<p class="error" role="alert">${escape(notice)}</p>`}
<form method="post" action="/sign-in${escape(query)}">
  <input type="hidden" name="step" value="email">
  <label for="email">Email</label><input id="email" name="email" type="email" required autocomplete="username">
  <button type="submit">Send code</button>
</form>`,
  );

/** Step two of sign-in: the code. */
export const codePage = (query: string, email: string, notice?: string): string =>
  shell(
    "Enter your code",
    `<h1>Enter your code</h1>
<p>We sent a six-digit code to <strong>${escape(email)}</strong>. It is valid for five minutes.</p>
${notice === undefined ? "" : `<p class="error" role="alert">${escape(notice)}</p>`}
<form method="post" action="/sign-in${escape(query)}">
  <input type="hidden" name="step" value="code">
  <input type="hidden" name="email" value="${escape(email)}">
  <label for="code">Code</label><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" required>
  <button type="submit">Sign in</button>
</form>`,
  );

export const chooseWorkspacePage = (
  query: string,
  workspaces: readonly { readonly id: string; readonly name: string }[],
): string =>
  shell(
    "Choose a workspace",
    `<h1>Choose a workspace</h1>
<p>You belong to more than one. Claude will read only the one you pick.</p>
${workspaces
  .map(
    (workspace) => `<form method="post" action="/choose-workspace${escape(query)}" class="inline">
  <input type="hidden" name="workspaceId" value="${escape(workspace.id)}">
  <button type="submit">${escape(workspace.name)}</button>
</form> `,
  )
  .join("")}`,
  );

export const consentPage = (
  query: string,
  params: {
    readonly clientName: string;
    readonly workspace: string;
    readonly scopes: readonly string[];
  },
): string =>
  shell(
    `Connect ${params.clientName}`,
    `<h1>Connect ${escape(params.clientName)}</h1>
<p>${escape(params.clientName)} will act as you, at <strong>${escape(params.workspace)}</strong>.</p>
<ul>
  ${params.scopes.includes("knowledge:read") ? "<li>Read what you can see of the company's knowledge</li>" : ""}
  ${params.scopes.includes("feedback:write") ? "<li>Send your feedback on answers</li>" : ""}
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
