---
status: accepted
date: 2026-08-31
---

# The MCP surface stays MCP SDK v2 in the TypeScript tier, mounted behind one fetch-shaped seam that makes FastMCP an afternoon's change rather than a tier move

`T-004` already names the implementation — MCP SDK v2 on the official Hono adapter,
`@better-auth/oauth-provider` + `@better-auth/cimd`, a hand-written protected-resource-metadata
document, dual-era serving on `legacy: "stateless"` — and `T-019` exists to test that naming
before it becomes code. It survives the test. **The MCP surface is built on MCP SDK v2 in
`apps/api`, unchanged**, and the one thing this ADR adds is a rule: the surface is reached as
`(Request, { authInfo }) => Response`, mounted in Hono, with the caller verified before it and the
Principal passed in, and no MCP library type crossing into `packages/core`.

The reason to add that rule rather than change the library is that **FastMCP TypeScript exposes
exactly the same shape**. `@prefecthq/fastmcp-ts` 1.7.1 has a public `fetch(request, options)`
entrypoint documented as "always stateless", not requiring `run()`, with "Authentication…
deliberately external — `options.authInfo` is trusted and passed unchanged" and the embedding
framework owning Host/Origin validation. So the choice between the plain SDK and FastMCP is a
choice **behind one seam**, reversible in an afternoon — which is precisely the kind of choice
that should be taken cheaply and not agonised over.

Three findings decided it, each read from a primary source on 31 August 2026 (`[DEPS1]`; the
research is `docs/research/mcp-approach-2026-08-31.md`).

**Dual-era serving is not a differentiator.** It was framed as FastMCP's advantage. It is not:
`@modelcontextprotocol/server` 2.0.0's own type definitions document `legacy?: 'stateless' |
'reject'` on `createMcpHandler`, with `'stateless'` as **the default, also when the option is
omitted** — a fresh instance per legacy request over a streamable HTTP transport, one handler
answering both the 2025 and the 2026-07-28 eras. FastMCP TypeScript, FastMCP Python 4 and
Vercel's `mcp-handler` all do the same thing. `T-004`'s `legacy: "stateless"` line is correct and
is the SDK's default, not a workaround.

**FastMCP's real advantage is authentication, and it is Python-only and does not apply to us.**
FastMCP Python 4.0.0 carries an OAuth proxy, an OIDC proxy, a full OAuth server, multiple auth
sources, a dozen named identity-provider integrations, and **server-side identity assertion
(SEP-990)** in `fastmcp.server.auth.identity_assertion`, marked beta. FastMCP TypeScript 1.7.1
carries `oauthProvider` and `oauthProxy` under a documentation heading its own authors wrote,
**"Interim status"**: both are "built on the frozen `@modelcontextprotocol/server-legacy/auth`
package — the 2025-era auth implementation, kept working but no longer evolving", relying on
Dynamic Client Registration, which the 2026-07-28 revision deprecates; the built-in provider holds
clients, codes and tokens **in memory** and **auto-approves every authorization request**. It has
no SEP-990, no identity assertion, no ID-JAG, nothing on RFC 8693 or RFC 7523 anywhere in its
documentation set. So the TypeScript library is materially weaker than the incumbent on the one
axis that matters most, and the Python library's strength is shaped for the arrangement we
deliberately do not have: FastMCP's SEP-990 hangs off `OAuthProxy`, where **someone else** owns
the accounts, while ADR 0009 makes the app **its own authorization server**.

**SEP-990 is a real gap that nobody on our side has closed, and it is a week of work, not a tier
move.** Better Auth has no ID-JAG page; SEP-990 is an open implementation issue against the
official TypeScript, Python and Kotlin SDKs alike. When a customer's IT department asks for
enterprise-managed authorization, the work is to accept the RFC 7523 `jwt-bearer` grant at Better
Auth's token endpoint and validate signature, issuer, audience, `typ`, `sub` and `jti` replay,
behind `[DESIGN5]`'s existing seam. Buying that today by moving a transport into the Python
worker would trade one week of future work for a permanent second identity boundary.

**This ADR is therefore not an ADR against ADR 0005's two tiers, and not against ADR 0029's one
deployable.** `T-019` named the condition under which it would have been — "if the answer is
Python-only FastMCP, the MCP surface leaves the TypeScript tier" — and that condition is not met.
MCP is a transport, it lives in `apps/api`, and ADR 0029's tree holds it. Both ADRs stand
untouched, and this sentence is here so that nobody has to reconstruct why.

**One further decision, taken now because the App changes what `open` must return.** Assistants
now render interfaces in the conversation — MCP Apps, supported by Claude, Claude Desktop and
Claude Cowork, where a tool names a `ui://` resource that the host draws in a sandboxed iframe.
Drawing the user flow — a manager asks a question, clicks a citation, reads the concept, presses
*this is wrong* — confirms **ADR 0018's five entries hold**: `describe_estate`, `find`, `ask`,
`open`, `give_feedback` are the right tool surface, and an App adds **views over three of them**,
not a sixth entry. But it changes one thing about `open`: designed as "the verbatim fetch", it
becomes the thing a person *looks at*, so **`open` returns structured content** — frontmatter,
body, relations, trust state, evidence as fields — with the human rendering derived from it. That
line goes into `T-004`, because without it the App layer is a rewrite of `open` rather than an
addition beside it. When the App is built it uses `@modelcontextprotocol/ext-apps` directly with
`apps/web`'s existing Vite React toolchain, not `mcp-use` and not Vercel's `mcp-handler`: both are
*server* frameworks solving a problem we do not have.

**And a scope reduction, recorded as one.** A user who asks a Claude platform to move information
from Better Answers into Notion or Asana reaches those systems through **their** MCP servers,
under **their** consent, with credentials we never hold. The Claude platform is the integrator.
**We therefore never build outbound connectors to third-party SaaS, no outbound OAuth client
machinery, no field mapping or sync engine, no outbound scheduler or webhook fan-out, no
per-destination rendering, and no connector directory of our own.** The **acting** credential
class (`[SEC1]`) is for acts on our own estate and for the ingestion side; it is never a
credential for writing into a customer's other systems. What we build instead is a read surface
good enough that an assistant can carry our knowledge anywhere, plus one way to send a correction
back — which is what ADR 0018 already describes.

## Considered options

- **FastMCP TypeScript (`@prefecthq/fastmcp-ts` 1.7.1, Apache-2.0) as the surface.** Genuinely
  better ergonomics, several of which map straight onto `T-004`'s hand-written list — rate
  limiting, caching, size limiting, logging and error-normalisation middleware, per-component
  scope checks, view-only transforms, a matching test client, a CLI that lists and calls your own
  tools — and the only TypeScript option with an MCP Apps layer that is not a whole other
  framework. Rejected **for now, not on principle**: its 1.x line is weeks old and released again
  on the day of this research; its authentication story is labelled interim by its own authors and
  we would switch all of it off; it pulls 19 direct dependencies including Express 5 into an
  all-Hono tier; and each middleware we would adopt has a `T-004` acceptance line specifying
  behaviour a framework's version would not satisfy (an `UNLOGGED` counter table, a TTL held in a
  config row, deterministic ordering). The seam this ADR adds is what keeps it a live option.
- **FastMCP Python (`fastmcp` 4.0.0) — the MCP surface moves to the worker tier.** The only option
  with SEP-990 today, and with by far the strongest authentication department. Rejected: its
  SEP-990 support attaches to `OAuthProxy`, which is the arrangement ADR 0009 chose against; it
  would put a transport, its OAuth pages and its audit path on the far side of a tier boundary
  from the Principal, the predicate and the answer records they must run inside; and it would
  contradict ADR 0005 and ADR 0029 to buy a beta module. **Had this been chosen, this ADR would
  have said so in its title.**
- **`punkpeye/fastmcp` (npm `fastmcp` 4.17.1).** Not a candidate. Unrelated to Prefect, and its
  own README states it implements "legacy MCP revisions (2025-11-25 and earlier)" and "does not
  support the current specification (2026-07-28)". Recorded here only because it owns the
  unscoped npm name and would be installed by anyone typing `fastmcp`.
- **Vercel's `mcp-handler` 2.1.1.** A framework-agnostic adapter turning a server definition into
  a fetch handler mountable in Hono. Rejected as a thinner version of what
  `@modelcontextprotocol/hono` 2.0.0 already gives us, with no MCP Apps layer at all.
- **`mcp-use` 2.3.4 as the App framework.** Full-stack, MIT, on SDK v2, with React view hooks, a
  CSP story, an inspector and a documented Better Auth provider. Kept as the **named runner-up**
  for the App layer, to be reached for only on the evidence that hand-rolling the `postMessage`
  bridge over `ext-apps` is fiddly in practice.
- **Adopting nothing and deciding later.** Rejected because `T-004` names an implementation, so
  "later" means unpicking. The seam is the cheaper form of the same instinct: decide now, keep the
  decision reversible.

## Consequences

- **`T-004`'s acceptance criteria stand, with three amendments and one correction.** Add the seam
  line (`(Request, { authInfo }) => Response` mounted in Hono, no MCP library type in
  `packages/core`, lint-enforced); add structured output from `open`; add the tools-only
  clarification below. **The correction:** `T-004` says "four-entry MCP surface" and "Four
  entries" where ADR 0018 says **five**. The ADR is the decision of record, so the task reads
  five — or dropping one is an amendment to ADR 0018, not an edit to a task.
- **ADR 0008's tools-only rule is clarified, not amended.** No concept is served as an MCP
  resource in v0.1; that deferral stands. A `ui://` view resource, when the App is built, is not a
  concept and is not what that rule refuses. ADR 0018 already kept concept resources "as a later
  addition behind the same `okf://` URIs"; this is a different thing arriving first.
- **`okf://` and `ui://` are two wire schemes and must not be conflated.** `okf://` identifies a
  concept; `ui://` identifies a view. Both are on the wire and never in a file (ADR 0018's and
  ADR 0002's amendments).
- **`give_feedback`'s description changes even though the entry does not.** In a view it is a
  button the App presses, not something a person asks for in words; the description should stop
  assuming the model chooses it conversationally.
- **Proposing a concept stays a web link in v0.1.** An App could offer a form; a governed write
  path (ADR 0012) wants its first version where an Admin sees the whole queue.
- **SEP-990 becomes a named, sized future task rather than an unknown** — the RFC 7523
  `jwt-bearer` grant on Better Auth's token endpoint, behind `[DESIGN5]`'s seam, roughly a week.
  It is also a fourth thing to watch alongside ADR 0009's three leave-triggers: if the self-hosted
  OAuth path never gains it while hosted alternatives do, that is evidence about the trigger-2
  question, not a separate decision.
- **Three new domain words are settled and must reach `CONTEXT.md` before any of them appears in
  code (`[GLOSSARY1]`): `MCP App`, `view`, `ui://`.** They are listed with proposed definitions
  under `## Words for CONTEXT.md` in `docs/research/mcp-approach-2026-08-31.md`. *Protocol era*,
  *legacy era*, *modern era* and *dual-era serving* are deliberately **not** proposed: they are
  architecture words, the same judgement ADR 0029 made about *slice*, *kernel* and *access*.
- **The scope reduction above is a refusal list, and should be answerable in one sentence at a
  sales meeting.** The one case it does not cover is a customer wanting knowledge mirrored into
  another system with no person in the loop — a nightly sync rather than a request. That is
  outside this model; it is a product decision, and if it is ever taken it is a new ADR and a new
  deployable, not a feature.
- **This ADR is calibrated against no running MCP code.** Like ADR 0029, its first meeting with
  reality — `T-004` — is where it is expected to move. The seam is the part designed to survive
  being wrong.
