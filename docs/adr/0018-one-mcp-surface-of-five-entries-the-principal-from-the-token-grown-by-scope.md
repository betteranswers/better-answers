---
status: accepted
date: 2026-08-27
---

# One MCP surface of five outcome-shaped entries, the principal from the token, grown by scope and never by a second server

The platform's MCP surface is one tools-only server at `mcp.<domain>/mcp` with five entries a person or a model never has to learn — `describe_estate` (orient), `find` (the one search: a preview of hits by kind, bundle, type and tags), `ask` (a question in, the cited answer contract out), `open` (the verbatim fetch: a concept by IRI, or the passage a citation rests on by locator, one or many), `give_feedback` (the only write) — and nothing else in v0.1. The principal is the access token (`{workspace, user, role}`, audience-bound to the MCP URL); **no entry takes a workspace, bundle or tenant argument** — a lint rule and a functional test (`[SEC2]`); role and groups are re-read in one indexed query on every call and a token whose role disagrees, or whose `iat` precedes the user's `credentials_revoked_at`, is rejected. Every entry runs the same predicate as the app before ranking on every hop and lands in the same audit as the asker (ADRs 0016, 0017). The surface grows by **token scope** — `knowledge:read` and `feedback:write` today, `act:*` with the acting credential later — never by a second server, a second registration or a second audit stream; `tools/list` shows only what the token's scopes reach. We chose five outcome-shaped entries over one tool per record family (eight were drafted) because the predecessor's fifty-eight-tool surface showed what accretion does — a curation-heavy surface under consumption-heavy outcomes, and clients told "you don't need to remember the tools, just ask" — and because the long and the scheduled work (question sets, briefings, exposure sweeps) belongs to headless agents reading through these same entries and proposing into Suggestions, not to human entry points. Guides are not on the surface: an agent answering traverses concepts and reuses Answers (ADR 0016); a guide's claim is a concept `ask` already reaches; the guide-review agent is the agentic layer's, on the platform's side, over the same renderer (ADR 0015). **Read the 2026-08-31 amendment first: `describe_estate` is dropped and the surface is four entries.**

## Considered options

- **Eight tools, one per record family** (`search_knowledge`, `read_concept`, `read_guide`, `read_evidence`, `answer_question_set`, …) — complete and tool-shaped; two reviewers found it doubles payloads, leaks "cited in N" by arithmetic, and carries a question-set task that a stateless two-replica server cannot serve without a Postgres task store; Liam found it conflated Guides.
- **Three entries** (`find` carrying orientation and the verbatim fetch by argument) — fewest names; one entry with three jobs.
- **Resources for concepts and guides** — MCP-native for documents; claude.ai's connector surface is tools-first and ADR 0008 fixed tools-only; kept as a later addition behind the same `okf://` URIs.
- **A second server for acting** (`act.<domain>`) — a wall an Admin can see, and two of everything for the same person.
- **Groups in the token** — one read fewer, stale for up to an hour.

## Consequences

- Unmapped passages are returned by `ask` on a *refuse* or *warn* answer — at most three, under the predicate, each led in the text by *Not company knowledge* and its sensitivity word; the tool description says "quote, name the source, do not summarise"; the one act is a web link to *suggest a concept from this*. The text rendering of every result is the human rendering, never the JSON; every citation carries a plain web URL beside its `okf://` link; "cited in N answers" never leaves the app.
- The question set is the web's in v0.1 (20 Q7); `ask` links to it. This **reopens ticket 47 Q10** ("also an MCP tool"): the MCP form returns as a headless agent's job in the agentic layer, not as a human entry.
- `ask` is one synchronous call with `notifications/progress` under a sixty-second budget; the estate summary is `depth: summary` by default.
- Access tokens live one hour with rotating refresh; a **personal token** (the `api_token` record; same principal shape and scopes; ninety days by default; shown once) is the second credential path for Claude Code and scripts, minted by the person on a small **Account** page outside Control Centre and listed to Admins in People; an Admin minting for another person is an audit event with both principals; no token without a user, none shared.
- The consent page is the platform's, in the person's words: who Claude will act as, at which workspace; "read what you can see of the company's knowledge"; "send your feedback on answers"; "every question you ask through Claude is recorded as asked by you". A multi-organisation user picks an organisation before consent.
- Rate limits are a Postgres counter per (token, window) with a one-sentence 429; answer spend is reserved at call start and settled on `done` against the workspace's ceiling family (53); at the ceiling only `ask` refuses, with "an Admin can raise it in System" — `find` and `open` keep working.
- A **Connected clients** card in System shows the URL to copy, the fallback pre-registered client id, registered clients by name and who has connected.
- Two things stay unproved until the prototype ticket runs against claude.ai: DCR and CIMD with its real registration body, and the workspace claim (ADR 0009's own condition); the prototype also measures the entries' budgets on the first client's estate (it ran, and `describe_estate` was dropped — see the 2026-08-31 amendment).
- Words: *MCP surface*, *MCP tool*, *token scope*, *personal token*, *client* (a registered host); *connector*, *endpoint*, *MCP* and *scope id* never reach a screen.

## Amendment — 2026-08-30, `okf://` is a wire URI and never a file reference (ticket 79, the pre-build gate; applied by T-001)

This ADR's consequences carry `okf://` in two places — resources "behind the same `okf://` URIs" and "every citation carries a plain web URL beside its `okf://` link". Both are correct and both are **on the wire**: `okf://` is an MCP resource URI, minted and resolved by this server. ADR 0002 rejected `okf://` as the way one **concept file** references another, and that rejection is untouched — a reference inside a bundle is an absolute HTTPS IRI a link checker can follow. **On the wire yes, in a file never** (ADR 0002's matching amendment). Everything else stands.

## Amendment — 2026-08-31, `describe_estate` is dropped; the surface is four entries (A26 from the pre-build gate; prototype 61)

**The surface is `find`, `ask`, `open`, `give_feedback`.** Everywhere this ADR says *five entries* or names `describe_estate`, read **four**. The title and the filename keep their old wording so every reference to this ADR still resolves.

Three findings from prototype 61 removed it, and none of them is about tool count. All four remaining entries **answered through Cowork against the real claude.ai client**, with no orienting call before them — the failure the entry existed to prevent (research 35's *"progressive disclosure depends on the model guessing"*) did not occur. Its budget was never measurable: **no estate exists yet**, and the staff-engineer review had already put it at 6–8k tokens on every conversation's first call at 200 bundles, against ≈1.5k at 50. And its `depth: summary | full` fork, added to contain exactly that cost, goes with it.

What replaces it is nothing. An agent orients by calling `find`, which is the preview step and already returns hits by kind, bundle, type and tags. The estate manifest returns only if a measured need for it appears against a real estate — and then as a *decision*, not as a shape agents have already learned.

Two things this does not touch. **The read/write split still lands in the host's own permission UI**: claude.ai divided the four into "Write/delete tools 1" and "Other tools 3" from `readOnlyHint` alone, which is what `[SEC2]`'s annotation requirement buys. And the surface still **grows by token scope, never by a second server** — that argument was about accretion, and dropping an entry is its opposite.

One correction rides with this. This ADR's principal is `{workspace, user, role}`; the token claim set observed from claude.ai carries **no `role`**, so it is `{workspace, user}` with the role read per call, in the same transaction as the read it authorises (`T-004`). Everything else stands.

## Amendment — 2026-09-03, the surface's address (T-045, ADR 0034)

"`mcp.<domain>/mcp`" reads **`app.<domain>/mcp`**: the MCP surface answers on the product's own origin, and every access token's audience is that URL (ADR 0034). Nothing else changes — the four entries, the principal from the token, the per-call revocation check and the growth by token scope all stand.
