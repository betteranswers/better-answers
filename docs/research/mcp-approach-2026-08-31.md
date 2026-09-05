---
date: 2026-08-31
task: T-019
status: research
---

# How we should build the MCP surface, and what we should never build

Read on 31 August 2026. Every version and capability below was read from the vendor's own
registry, repository or documentation on that day and is cited with its URL. Nothing here is
recalled (`[DEPS1]`).

This is written for a reader who wants the reasoning, not only the answer. It is long in the
places where the reasoning is the point and short where the answer is obvious.

---

## 1. The question, in plain words

The platform will publish a **way for AI assistants to read the company's knowledge**. That
"way" is a standard called MCP — Model Context Protocol — and it is, in the end, just an HTTP
endpoint that speaks an agreed dialect. `T-004` is the task that builds it, and `T-004`'s
acceptance criteria already name a specific set of libraries. So the honest question is not
"what could we build with?" but: **is the answer already written into `T-004` the right one, and
if it is not, is now the moment to change it?** Once `T-004` lands, changing it is unpicking.

Three sub-questions decide it:

1. Is there a better foundation than the one `T-004` names — specifically, **FastMCP**?
2. Would choosing FastMCP move the MCP surface out of the TypeScript tier and into Python? That
   would contradict ADR 0005 (two tiers) and ADR 0029 (one TypeScript deployable), which is a
   much larger decision than a library choice.
3. Is the *shape* of the surface right — ADR 0018's five entries — now that assistants can render
   real interfaces inside the conversation rather than only text?

---

## 2. Untangling the name: there are three FastMCPs

The task was right that the ambiguity is real. It resolves cleanly once read.

| Name | What it actually is | Latest, read 31/08/2026 |
| --- | --- | --- |
| **FastMCP (Python)** — `gofastmcp.com`, PyPI `fastmcp` | The original. A full Python framework for MCP servers, clients and apps. Made by **Prefect**. | **4.0.0**, uploaded **2026-08-31T18:20:31Z**, requires Python ≥3.10 |
| **FastMCP TypeScript** — `github.com/PrefectHQ/fastmcp-ts`, npm `@prefecthq/fastmcp-ts` | The **official** TypeScript counterpart, same team at Prefect. Built on MCP SDK **v2**. | **1.7.1**, published **2026-08-31T18:43:52Z**, Apache-2.0 |
| **`punkpeye/fastmcp`** — npm `fastmcp` | An **unrelated** third party that took the same name first on npm. | **4.17.1**, published **2026-08-31T06:30:49Z**, MIT |

Sources: the FastMCP Python documentation states "FastMCP is made with 💙 by Prefect" and "FastMCP
for TypeScript is the official counterpart, built and maintained by the same team"
(<https://gofastmcp.com/getting-started/welcome>); the TypeScript repository describes itself as
"the official TypeScript counterpart to FastMCP for Python"
(<https://github.com/PrefectHQ/fastmcp-ts>); versions and dates from the npm registry
(<https://registry.npmjs.org/@prefecthq/fastmcp-ts>, <https://registry.npmjs.org/fastmcp>) and
PyPI (<https://pypi.org/pypi/fastmcp/json>).

**The trap to be aware of.** On npm, the plain name `fastmcp` is the third party's package; the
official one is scoped `@prefecthq/fastmcp-ts`. Anyone installing "fastmcp" in this repository
by name alone gets the wrong library. And the third party's own README now says it "implements
legacy MCP revisions (2025-11-25 and earlier)" and "does not support the current specification
(2026-07-28)", pointing readers elsewhere — so it is not a candidate on the merits either
(<https://github.com/punkpeye/fastmcp>).

Both official FastMCPs cut a release **on the day of this research**. That is a project moving
fast, which is a strength for features and a caution for stability.

---

## 3. Two eras of the protocol, and who handles the seam

This matters more than any library choice, so it is worth stating plainly.

MCP changed shape on **2026-07-28**. The old protocol (2025 and earlier) opens a *session*: the
client says hello, the server remembers who it is talking to, and later messages ride that
session. The new protocol has no session at all — every request stands alone and carries
everything needed to answer it. Anthropic's own announcement describes it as moving "from a
bidirectional stateful protocol to a request/response model", enabling serverless and edge
deployment, with extensions and authorization hardened alongside
(<https://claude.com/blog/bringing-mcp-2026-07-28-to-claude>).

For us, statelessness is good news: any replica can answer any request, no sticky sessions.

But the world has not all moved. Some clients still speak the old protocol. So a server that
wants to be reachable by everyone must serve **both eras at once** — "dual-era serving". The
question the task asks is whether that falls to us to write.

**It does not, on any of the options.** This surprised me, because it was framed as a FastMCP
advantage and it turns out to be table stakes:

- **The plain MCP TypeScript SDK v2 already does it, by default.** Reading the shipped type
  definitions of `@modelcontextprotocol/server` 2.0.0, `createMcpHandler` takes a `legacy` option
  typed `'stateless' | 'reject'`, documented as: *"`'stateless'` (the default, also when the
  option is omitted) — old-school stateless serving: each legacy request is answered by a fresh
  instance from the same factory over a streamable HTTP transport"*, and `'reject'` as
  *"modern-only strict"*. One handler, both eras, and the value `T-004` names is the default.
  (Read from the published tarball, `dist/createMcpHandler-CLhGwQTn.d.mts`;
  <https://registry.npmjs.org/@modelcontextprotocol/server>.)
- **FastMCP TypeScript does it too**, with the same rule stated as doctrine: "A server serves both
  eras. A client chooses one… A FastMCP server needs no era configuration"
  (<https://fastmcp-ts.docs.prefect.io/concepts/protocol-eras>).
- **FastMCP Python 4 does it too** (<https://gofastmcp.com/getting-started/whats-new>).
- **Vercel's `mcp-handler`** does it too: "serves the 2026-07-28 MCP specification natively while
  transparently falling back to stateless Streamable HTTP for 2025-era clients"
  (<https://github.com/vercel/mcp-handler>).

**Conclusion for the record:** dual-era serving is handled by the library in every option on the
table, including the incumbent. It is not a reason to choose anything. `T-004`'s
`legacy: "stateless"` line is correct and is, in fact, the SDK default.

---

## 4. Where the two FastMCPs actually differ: authentication

This is the real parity gap, and it points the opposite way to the way one might expect.

### What the Python one has

FastMCP Python's documentation index lists a full authentication department: Token Verification,
**Remote OAuth**, **OAuth Proxy**, **OIDC Proxy**, **Full OAuth Server**, **Multiple Auth
Sources**, plus storage backends for OAuth state, and prewritten integrations for Auth0, WorkOS
AuthKit, AWS Cognito, Azure/Entra, Discord, GitHub, Google, Hugging Face, Keycloak, OCI, Permit,
PropelAuth, Supabase (<https://gofastmcp.com/llms.txt>).

And it has **identity assertion — SEP-990**. There is a module
`fastmcp.server.auth.identity_assertion`, documented as "Server-side identity assertion (ID-JAG)
support for FastMCP (SEP-990)", marked **beta**, which validates an Identity Assertion JWT
Authorization Grant issued by a corporate identity provider and lets the authorization server
mint a short-lived access token for the asserted employee, with no refresh token — "the client
re-exchanges a fresh ID-JAG instead, and revocation lives at the IdP"
(<https://gofastmcp.com/python-sdk/fastmcp-server-auth-identity_assertion.md>). It attaches to
`OAuthProxy` via an `identity_assertion` parameter.

For context on what SEP-990 is for: it lets a company's own identity provider (Okta, Entra)
decide centrally which MCP servers its staff may use, and gives those staff single sign-on across
them without authenticating to each server separately
(<https://modelcontextprotocol.io/seps/990-enable-enterprise-idp-policy-controls-during-mcp-o>,
<https://blog.modelcontextprotocol.io/posts/enterprise-managed-auth/>).

### What the TypeScript one has

Far less, and it says so itself. `@prefecthq/fastmcp-ts` offers `oauthProvider` and `oauthProxy`,
and the documentation carries a section headed **"Interim status"**:

> "Both `oauthProvider` and `oauthProxy` are built on the frozen
> `@modelcontextprotocol/server-legacy/auth` package — the 2025-era auth implementation, kept
> working but no longer evolving… The 2026-07-28 revision deprecates Dynamic Client Registration,
> the mechanism both arrangements rely on… which is why it is positioned as an interim rather
> than the long-term answer."

It also notes the built-in provider "holds all of its state — registered clients, authorization
codes, issued tokens — in memory" and "auto-approves every authorization request", so
"restarting the process invalidates every issued token", unless you supply your own persistent
`OAuthServerProvider` (<https://fastmcp-ts.docs.prefect.io/servers/auth/oauth>).

Searching the whole TypeScript documentation set for identity assertion, SEP-990, ID-JAG, token
exchange or RFC 8693 returns **nothing** (<https://fastmcp-ts.docs.prefect.io/llms.txt> and the
auth pages beneath it).

### The three answers the task asked for, stated plainly

- **OAuth-proxy support:** Python **yes**, and mature (plus an OIDC proxy and a dozen named
  integrations). TypeScript **yes in name only** — present, but built on a frozen package the
  vendor labels interim, using a mechanism the current spec deprecates.
- **Identity assertion (SEP-990):** Python **yes (beta)**. TypeScript **no**.
- **Dual-era serving:** **both, and so does the plain SDK.** Not a differentiator.

### Why the SEP-990 gap is smaller than it looks

Two reasons, and they matter.

First, **FastMCP's SEP-990 support hangs off `OAuthProxy`** — the arrangement where *someone else*
owns the user accounts and FastMCP puts an MCP face on them. Our design is the opposite: ADR 0009
makes the app **its own authorization server**, with Better Auth in-process. FastMCP's
implementation is not shaped for our arrangement, so "Python has it" does not translate to "we
would get it".

Second, **nobody in the TypeScript world has it either.** Better Auth's documentation, searched
on the day, has no SEP-990, ID-JAG or jwt-bearer-grant page; the closest results are Microsoft
client assertions and generic client-authentication strategies
(Better Auth docs, `latest`, searched 31/08/2026). SEP-990 is filed as an open implementation
issue against the official TypeScript SDK, the Python SDK and the Kotlin SDK alike
(<https://github.com/modelcontextprotocol/typescript-sdk/issues/1090>).

So SEP-990 is **a genuine future capability gap, and one nobody on our side of the fence has
closed.** When a customer's IT department asks for it, the work is: accept the RFC 7523
`jwt-bearer` grant at Better Auth's token endpoint, validate the assertion's signature, issuer,
audience, `typ`, `sub` and `jti` replay, and mint a short-lived token. That is a well-specified
piece of work of maybe a week, against a plugin we already own the seam for (ADR 0009). It is
not a reason to move a tier.

---

## 5. The incumbent, described fairly

What `T-004` already names:

- **MCP SDK v2** — `@modelcontextprotocol/server` **2.0.0**, published **2026-07-27T23:55:22Z**,
  MIT, depending only on `zod ^4.2.0` and `@modelcontextprotocol/core`. Its sibling
  **`@modelcontextprotocol/hono` 2.0.0** (same date, MIT, zero dependencies) is the official Hono
  adapter — "Hono helpers (app defaults + JSON body parsing hook + Host header validation)"
  (<https://github.com/modelcontextprotocol/typescript-sdk>, npm registry).
- **`legacy: "stateless"`** — the SDK's default, quoted in §3.
- **Better Auth 1.7.2** (2026-08-26, MIT) with **`@better-auth/oauth-provider` 1.7.2** and
  **`@better-auth/cimd` 1.7.2** (both 2026-08-26, MIT), the arrangement prototype 61 already drove
  end to end against the real claude.ai connector (ADR 0009's 2026-08-30 amendment).
- A **hand-written protected-resource-metadata document**, because the generated one got the
  `resource` value wrong.

Read on its own terms, this is a small, boring, MIT-licensed stack of four packages, three of
which are maintained by the protocol's own authors, with the risky half (authentication) already
**proved against the actual client we care about**. That last fact is worth more than any feature
list: prototype 61 is evidence, and evidence beats a comparison table.

Its weaknesses are real too. The SDK gives you a protocol handler and nothing else: no
middleware, no rate-limiting helper, no response cache, no per-tool authorization helper, no
test client, no CLI to poke at your own server. Every one of those we write ourselves — and
`T-004`'s acceptance list is, read closely, largely a list of exactly those hand-written pieces.

---

## 6. The judged comparison — two people, not a feature count

The right question is not "which has more features" but **"which one costs a two-person team less
over the next two years, and which one is cheaper to walk away from?"**

**Fact that reframes everything.** FastMCP TypeScript is **embeddable**. Its `FastMCP` class has a
public, documented `fetch(request, options)` method: *"Serve an MCP request through a
web-standard, fetch-native HTTP entrypoint. This entrypoint is always stateless and does not
require `run()`… Authentication is deliberately external — `options.authInfo` is trusted and
passed unchanged into the protocol handler… The embedding framework also owns Host/Origin
validation"* (<https://fastmcp-ts.docs.prefect.io/api/server/classes/FastMCP.md>).

That is **the same shape as the SDK's own handler** — a `Request` in, a `Response` out, with the
verified caller passed in from outside. Which means:

> The choice between the plain SDK and FastMCP TypeScript is a choice **behind one seam**, and it
> is reversible in an afternoon.

Both sit inside the same Hono app in `apps/api`. Both take authentication from Better Auth
outside themselves. Neither touches ADR 0005, ADR 0009 or ADR 0029. This is the single most
important finding in this document, and it demotes the whole question from architecture to
library preference.

Given that, the maintainability judgement:

**For the incumbent (plain SDK + Hono adapter):**

- **Four small dependencies, all MIT, three from the protocol's authors.** When the spec moves,
  they move first — the SDK shipped v2 on the day the spec landed.
- **The half that can hurt us is already proved.** Prototype 61 drove the real connector through
  this exact arrangement.
- **We use none of FastMCP TypeScript's headline features.** Its OAuth provider and proxy are the
  two biggest things it adds, and we would switch both off: we have Better Auth, CIMD-only, with
  a persistent token store — where FastMCP's is in-memory, auto-approving and built on a frozen
  package. Paying a framework's maintenance cost for the parts you disable is the classic
  two-person-team mistake.
- **Fewer moving parts to reason about at 2am.** `@prefecthq/fastmcp-ts` 1.7.1 pulls in **19
  direct dependencies**, among them Express 5, `@clack/prompts`, `listr2`, `chalk`, `cli-table3`
  and `chokidar` — a CLI's worth of machinery riding into a server image (npm registry,
  31/08/2026). Our tier is Hono; Express arriving alongside it is a smell even if it never
  listens.

**For FastMCP TypeScript:**

- **The ergonomics are genuinely better**, and several map directly onto `T-004`'s hand-written
  list: `RateLimitingMiddleware`, `CachingMiddleware`, `SizeLimitingMiddleware`,
  `LoggingMiddleware`, `ErrorNormalizationMiddleware`, per-component scope checks, view-only
  transforms, a matching test client, and a CLI that lists and calls your own tools
  (<https://fastmcp-ts.docs.prefect.io/llms.txt>).
- **It is the only TypeScript option with an MCP **Apps** layer that is not a whole other
  framework** — `FastMCPApp`, a server-side component library, and ready-made Approval, Choice,
  FileUpload and FormInput providers.
- **Apache-2.0**, which sits inside ADR 0027's allowed set.

**Against it, decisively for now:** it is **eight weeks old in its 1.x line and released again the
day this was written**; its authentication story is labelled interim by its own authors; and the
features we would actually use are middleware we can write in a day each, against a `T-004`
acceptance list that already specifies exactly how each should behave (an `UNLOGGED` counter
table, a real TTL held in a config row, deterministic ordering). A framework's rate limiter would
not satisfy those lines; we would configure around it.

### Recommendation

**Build `T-004` on the incumbent, unchanged.** MCP SDK v2, `@modelcontextprotocol/hono`, Better
Auth in-process, hand-written PRM, `legacy: "stateless"`.

**And write the seam down as a rule**: the MCP surface is reached as `(Request, {authInfo}) =>
Response`, mounted in Hono, with authentication resolved before it and the Principal passed in.
Tools are plain functions over `packages/core` slice interfaces, holding no library types. Do
that and adopting FastMCP TypeScript later — most plausibly when we build the App layer, once its
auth story has stopped being "interim" — is a contained change, not a rewrite. **That is what makes
this a cheap decision to get wrong.**

**The MCP surface does not leave the TypeScript tier.** ADR 0005's two tiers and ADR 0029's one
deployable stand untouched. FastMCP Python's advantage is entirely in authentication, we are our
own authorization server so most of it does not apply, and moving a transport into the Python
worker to obtain a beta module would trade one week of future work for a permanent second
identity boundary.

---

## 7. What an MCP App is, and whether ADR 0018's five entries hold

### What changed in the world

Assistants can now render **real interfaces inside the conversation**. The mechanism is an MCP
extension called **MCP Apps**: a tool's description points at a `ui://` resource via
`_meta.ui.resourceUri`; the host fetches that resource, which is an HTML page; the host renders
it in a **sandboxed iframe**; and the page talks back over `postMessage` in a small JSON-RPC
dialect, able to call tools on our server and receive fresh results
(<https://modelcontextprotocol.io/extensions/apps/overview>).

Supported today by **Claude, Claude Desktop**, VS Code GitHub Copilot, Microsoft 365 Copilot,
Goose, Postman, MCPJam and Archestra.AI (same page). Anthropic's own announcement adds that
interactive connectors are "available in Claude on mobile, web and desktop for Free, Pro, Max,
Team, Enterprise plans" and "**also now available on Claude Cowork**"
(<https://claude.com/blog/interactive-tools-in-claude>). The reference implementation is
`@modelcontextprotocol/ext-apps`, **1.7.5**, published **2026-07-23**, MIT, with starter examples
for React, Vue, Svelte, Preact, Solid and vanilla JavaScript (npm registry; the overview page).

The security model is worth noting for a knowledge platform: the iframe "can't access the parent
page, steal cookies, or escape their container", and the host controls which tools the app may
call.

### The flow, in prose

A finance manager at a UK SMB is in Claude Desktop. She types: *"What's our policy on approving
supplier invoices over £5,000?"*

Claude has the Better Answers connector installed. It calls **`ask`**. Behind the scenes the token
already says who she is and which workspace she is in — she never types a workspace name — and
the answer is assembled only from concepts she is allowed to see. What comes back is not a
paragraph of prose but a **cited answer**: a claim, and beneath it the concepts it rests on.

Today, that arrives as text with footnotes and web links. With an App, it arrives as a small
panel: the answer, and each citation as something she can click.

She clicks one — *Supplier Invoice Approval*. That click is the App calling **`open`** on her
behalf, and what renders is the **concept**: its definition in the company's own words, who
verified it and when, how much the platform trusts it, what it relates to, and the passage of the
original document the claim rests on. She is reading a **concept file**, and she has not left the
conversation, opened a browser tab, or logged in a second time.

She notices it is out of date — the threshold went up in April. Today her only route is a web
link out to the platform. With an App, there is a button: *this is wrong*. Pressing it calls
**`give_feedback`** with the concept already attached, and the correction lands in the same
inbox an Admin reviews, as a suggestion, gated by a person (ADR 0012).

She then asks Claude to put the policy summary into the team's Notion page. Claude does that
**through Notion's own MCP server**, which she has already connected. Better Answers is never
told, never asked, and holds no Notion credential. That is §8.

### Do the five entries hold?

**Yes — with one clarification that should be written down before anyone builds.**

The five entries are the right **tool** surface. Nothing in the flow above needs a sixth tool.
`describe_estate` orients, `find` searches, `ask` answers, `open` fetches verbatim,
`give_feedback` writes. The App did not add entries; it added **views over three of them**.

The clarification: **an MCP App is resources, not tools.** A `ui://` resource bound to `ask`, a
`ui://` resource bound to `open`, and possibly one bound to `find`. That sits awkwardly with two
prior decisions and both should be named rather than discovered later:

- **ADR 0008 fixed "tools-only".** ADR 0018 already softened this — it lists "Resources for
  concepts and guides" as a considered option, rejected because "claude.ai's connector surface is
  tools-first", but "kept as a later addition behind the same `okf://` URIs". **That later
  addition is now due, and it is a different kind of resource than the one that was deferred.**
  A `ui://` resource is not a concept served as a document; it is a piece of interface. The
  tools-only rule should be restated as *no concept is served as an MCP resource; a `ui://` view
  resource is not that.*
- **ADR 0018's amendment says `okf://` is a wire URI.** `ui://` is a second wire scheme, owned by
  the MCP Apps extension, and the two must not be confused: `okf://` identifies a concept,
  `ui://` identifies a view.

Two smaller notes from drawing the flow:

- **`open` is the entry that changes most.** Designed as "the verbatim fetch", it becomes the
  thing a person *looks at*. A concept has structure — frontmatter, body, relations, trust,
  evidence — and that structure is what a view renders. `open`'s result shape should be
  structured output, not a formatted string, so the same call feeds both a text renderer and a
  view. This is a real design consequence and worth a line in `T-004`.
- **`give_feedback` stops being something a person asks for in words.** Today a user would have to
  say "tell Better Answers this is wrong". In a view it is a button the App presses. The entry is
  unchanged; its *description* should stop assuming the model chooses it conversationally.

**One thing the five entries genuinely do not cover, and should not yet.** Nothing lets a person
*propose a concept* from what they are reading. ADR 0018 answers this with "a web link to
*suggest a concept from this*", and with an App that could become an in-conversation form. It
should stay a web link in v0.1: proposing knowledge is a governed write path (ADR 0012) and the
first version of it belongs where an Admin can see the whole queue.

### Recommendation on MCP App tooling

`mcp-use` **2.3.4** (2026-08-31, MIT) is a full-stack MCP framework on SDK v2 with React views,
hooks (`useToolContext`, `useViewState`, `useCallTool`, `useDisplayMode`), a Content-Security-
Policy story, an inspector, and — notably — **a documented Better Auth provider**
(<https://docs.mcp-use.com/llms.txt>, <https://registry.npmjs.org/mcp-use>).

Vercel's **`mcp-handler` 2.1.1** (2026-08-13, Apache-2.0) is not really in this race. It is "a
framework-agnostic HTTP adapter", turning a server definition into a `(Request) =>
Promise<Response>` mountable in Hono. It is a thinner version of what the official Hono adapter
already gives us, and its README says nothing about MCP Apps at all
(<https://github.com/vercel/mcp-handler>).

**Recommendation: neither, as a framework.** When we build the App, use
**`@modelcontextprotocol/ext-apps` directly**, with the view bundled by the Vite React toolchain
`apps/web` already runs. The reasons are the same as §6's: both `mcp-use` and `mcp-handler` are
*server* frameworks solving a problem we do not have — we already have Hono, Better Auth and a
proven OAuth path — while the App-specific value lives in `ext-apps`, which both of them wrap.
Going direct means one MIT dependency, our own React components, and no second opinion about how
our server should be structured.

**Runner-up, named so it is not re-litigated:** `mcp-use`, for its React hooks, *if* hand-rolling
the `postMessage` bridge turns out to be fiddly in practice. Its Better Auth provider means it
would not fight our identity decision. Reach for it only on that evidence.

---

## 8. What we never build

This is the most valuable paragraph in this document, and it is a **scope reduction**.

A user asks Claude to move something from Better Answers into Notion, or to raise an Asana task
from a policy gap. Claude does this by holding **two** connections: ours, and Notion's or
Asana's. It reads from us through our MCP surface and writes to them through **their** MCP
servers, under **their** OAuth consent, with credentials **we never see**. The Claude platform is
the integrator. This is the explicit design intent of the extension model — an app "can request
an outcome (like 'schedule this meeting'), and the host routes it through the user's existing
connected capabilities", instead of "every app implementing and maintaining direct integrations"
(<https://modelcontextprotocol.io/extensions/apps/overview>).

**Therefore we never build, and should refuse when asked:**

1. **No outbound connectors to third-party SaaS.** No Notion writer, no Asana writer, no Slack
   poster, no Google Docs exporter, no Jira integration. Not in v0.1, not in v1.0, not as a
   "small one for this client".
2. **No outbound OAuth client machinery.** No per-destination app registrations, no token vault
   for other people's systems, no refresh loops, no scope negotiation with third-party providers.
   Our *ingestion* credentials (`[SEC1]`) stay; the **acting** credential class is for acts on
   **our own** estate and for the ingestion side — never for writing into a customer's other SaaS.
3. **No field mapping, no sync engine, no conflict resolution.** No "map concept type to Notion
   property", no two-way sync, no last-writer-wins. These are the features that eat platforms.
4. **No outbound scheduler or webhook fan-out** for pushing knowledge to other systems.
5. **No per-destination rendering.** No "export as a Confluence page", no Notion block converter.
   We render concepts one way — the human rendering (ADR 0018) — and the assistant carries it.
6. **No connector directory of our own.** We are a server in Claude's directory, not a hub.

**What we build instead, and it is much smaller:** a read surface good enough that an assistant
can carry our knowledge anywhere, plus one way to send a correction back. `ADR 0018`'s "grown by
token scope, never by a second server" already encodes the discipline; this section says what the
scopes are *not* for.

**The honest caveat.** This holds while the assistant is the intermediary. If a customer wants
knowledge in Notion *without* a person asking an assistant for it — a nightly sync, an automatic
mirror — that is outside this model and is a product decision, not an engineering one. Say no by
default; if it is ever said yes to, it is a new ADR and a new deployable, not a feature.

---

## 9. `T-004`'s acceptance criteria

**They stand, with three amendments and one correction.** The core of the list — Better Auth with
`oauth-provider` + `cimd`, the hand-written PRM, the lift of the `cimd/node` fix, the principal
resolved in the same transaction as the read, the rate limiting, the SSRF policy, the conformance
tests, the `tools/list` TTL, no workspace argument — is unaffected by everything above and was
verified against primary sources today. `legacy: "stateless"` is confirmed correct, and is the
SDK's own default.

**Correction, and it needs an answer before the build:** `T-004` says "the **four**-entry MCP
surface" and "**Four** entries, host-agnostic". ADR 0018 says **five**: `describe_estate`, `find`,
`ask`, `open`, `give_feedback`. One of the two is wrong. The ADR is the decision of record, so the
task should read five — unless the owner intends to drop one, in which case that is an ADR
amendment, not a task edit.

**Amendment 1 — add the seam as an acceptance line.** *"The MCP surface is mounted in Hono as a
`(Request, { authInfo }) => Response` handler with authentication resolved before it; no MCP
library type crosses into `packages/core`, and a lint rule enforces it."* This is what makes the
library choice reversible, and §6 recommends it in place of adopting FastMCP now.

**Amendment 2 — `open` returns structured output.** *"`open` returns structured content — the
concept's frontmatter, body, relations, trust state and evidence as fields, not a rendered
string — with the human rendering derived from it."* Without this line the App layer in §7 is a
rewrite of `open` rather than an addition beside it.

**Amendment 3 — record the tools-only clarification.** *"No concept is served as an MCP resource
in v0.1. A `ui://` view resource, when the App is built, is not a concept and is not covered by
that rule."* This keeps ADR 0008's tools-only decision meaningful once views exist.

**Not added, deliberately:** nothing about FastMCP, `mcp-use` or MCP Apps belongs in `T-004`.
`T-004` builds the read surface; the App is later work whose first prerequisite is the structured
`open` above.

---

## Words for CONTEXT.md

`CONTEXT.md` must not be edited by this session. These are the words the recommendation settles,
for the owner to add **before any of them appears in code**. Existing entries at lines 482–493 —
**MCP surface**, **MCP tool**, **open (an MCP entry)**, **token scope** — are unchanged by this
research.

1. **MCP App** — a view the platform serves for an assistant to render inside the conversation:
   an HTML page addressed by a `ui://` URI, named in an entry's metadata, drawn in a sandbox the
   host controls, able to call the same entries the assistant can. It shows a concept, an answer
   or a set of hits; it is never a second way in. *Avoid*: widget, panel, interactive connector
   (Claude's screens call it one; ours say **MCP App**) — consistent with the existing *Avoid*
   line on **connector**.
2. **view** — the rendering half of an MCP App: one `ui://` resource bound to one entry.
   Distinguish from the **human rendering**, which is the text form of the same result. Every view
   has a human rendering behind it; not every human rendering has a view.
3. **`ui://`** — the wire URI scheme for a view, owned by the MCP Apps extension. Sits beside
   `okf://` (ADR 0018's amendment) and means something different: `okf://` identifies a **concept**,
   `ui://` identifies a **view**. On the wire only, never in a file.

**Deliberately not proposed:** *protocol era*, *legacy era*, *modern era*, *dual-era serving*.
These are architecture words, not domain terms — the same judgement ADR 0029 made about *slice*,
*kernel* and *access*, and `[GLOSSARY1]` keeps them out. They belong in the ADR and in
`CODING_RULES.md` if anywhere.

---

## Correction — 2026-08-31, same day: the entry count is four

§7 and §9 above treat ADR 0018's **five** entries as the decision of record and `T-004`'s **four** as
an error. That is backwards. **A26** (ticket 79, the pre-build gate, 30/08/2026) dropped
`describe_estate` on the owner's riders from prototype 61 — where all four remaining entries answered
through Cowork with no orienting call before them, and where the entry's own budget was unmeasurable
because no estate exists. A26 post-dates ADR 0018. `T-001` recorded the disagreement and routed it to
`T-004`, which is why the task said four.

ADR 0018 and `CONTEXT.md` now read four; ADR 0030 carries an amendment.

**§7's judgement is unaffected.** The MCP App flow was drawn over `find`, `ask`, `open` and
`give_feedback`; `describe_estate` never appeared in it. Views are over three entries either way, and
`open` returning structured content is why the flow was drawn at all.

The gap it exposes is where the gate's answers live: in a briefing under `.scratch/`, outside the ADR
tree. Research that reads only `docs/adr/` reads true documents and reaches a stale conclusion.
