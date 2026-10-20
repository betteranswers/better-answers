---
title: "One MCP surface of four entries, the Principal from the token, grown only by scope"
date: 2026-09-26
module: apps/api
problem_type: architecture_pattern
component: transports
severity: high
applies_when:
  - "Adding or changing an MCP entry, its input or its output"
  - "Growing what an assistant can do through the MCP surface"
  - "Changing what `find` returns or what `open` takes"
tags:
  - adr-0018
  - mcp-surface
  - find
  - open
  - token-scope
  - principal
  - match
---

# One MCP surface of four entries, the Principal from the token, grown only by scope

## The decision

The MCP surface has four entries: `find`, `ask`, `open` and `give_feedback`. It answers at `app.<domain>/mcp` (ADR 0034).

- The Principal comes from the token. No entry takes a workspace, bundle or tenant argument. The lint rule `mcp-entry-no-workspace-argument` and a functional test of the surface hold this.
- Every call refuses a credential issued before the person's revocation instant or the member's.
- The MCP surface grows by token scope, never by a second server. The scopes today are `knowledge:read` and `feedback:write`. `tools/list` shows only the entries the token's scopes reach, and growth never adds a second registration or a second audit stream.
- An access token lives one hour, and each refresh rotates the refresh token.
- Calls are counted in Postgres per token per window. Past the ceiling, the surface answers 429 with one sentence.
- The platform serves its own consent page, in the person's words. It says who the assistant will act as and in which workspace, gives each scope in plain words, and says that every question asked through the assistant is recorded as asked by the person. A person in more than one workspace picks one before consent.
- No screen says *endpoint*, and none calls an assistant's connection a *connector*.

`find`'s match is a union by knowledge layer.

- A concept match (`layer: "bundles"`) sits beside a document match (`layer: "sources"`), which the rendering marks *Not company knowledge*. A document match carries the kind word *document*, the document's title, the wire locator `open` takes and the sensitivity word. *Not company knowledge* belongs to the rendering and is never a field.
- A document that a concept visible to the caller cites is left out.
- The caller's limit is spent on the union: concepts holding at least half the query's words first, then document matches, then the remaining concepts (owner, 09/10/2026).
- The two arms share no score. Each is ranked on its own, first by the rarity weight of the query's words a row holds, then by its full-text rank (owner, 14/10/2026).
- When more matches follow a page, the page carries `nextCursor`, and the next call passes it back as `cursor`.

`open` takes one IRI or one wire locator.

- A concept's evidence item carries its source.
- It carries the locator that opens its passage only where the source gives one.
- A locator with no passage address's shape, such as a page `p.4`, opens nothing. It reaches every reader as the item's `at` (owner, 09/10/2026).
- An evidence item whose locator is spaces only leaves the key out, as one with no locator does. A locator is never an empty string, and the item's line ends at the source's title or at its `at`.

`ask` cites a concept by an absolute URL under the product's origin, because an outside client cannot open a relative path (owner, 09/10/2026).

- `ask` returns at most three unmapped passages, read under the predicate. Each opens with *Not company knowledge* and its sensitivity word. The entry's description tells the assistant to quote such a passage with its source named, and never to summarise it.
- A count of the answers that cite a concept never leaves the api.

Decided and not yet in the tree:

- `ask` is one call that sends `notifications/progress` and runs under a sixty-second budget.
- An Admin who mints a personal token for another person records an audit event naming both people. A personal token always belongs to one person and is never shared.

## Why

- The predecessor's fifty-eight-tool MCP surface showed what accretion does: tools built for curation under outcomes built on consumption.
- Long and scheduled work (question sets, briefings, exposure sweeps) belongs to headless agents reading through these same entries and proposing into Suggestions.
- `describe_estate`, the fifth entry, was dropped. All four others answered through the real claude.ai assistant with no orienting call first, and its budget could not be measured with no estate. `find` is the preview step an agent orients by.
- The token from claude.ai carries no role, so the role is read per call, in the same transaction as the read it authorises.
- A reader asking for five matches is asking to be handed five things. Running both arms to five would hand them ten.
- A concept is the company's answer, and a raw passage is what there was no answer for. So a concept holding at least half the query's words comes first. Under any-word matching, a concept sharing one word is weaker evidence than a passage, and putting every such concept first would keep passages off the page (owner, 09/10/2026).
- One ranking across the two layers would need a score both arms share. S2a kept the arms apart (09/10/2026), and S2b's recall measure may reopen it.
- An imported bundle's `sources` entry often has no locator, since `sources[].locator` is a key the platform adds. An empty locator would be a passage `open` cannot fetch.

## Rejected

- Eight tools, one per record family: doubles payloads, leaks "cited in N" by arithmetic, and carries a question-set task a stateless server cannot serve.
- Three entries, with `find` carrying orientation and the verbatim fetch: one entry with three jobs.
- Resources for concepts and guides: claude.ai's support for these is tools-first, and ADR 0008 fixed tools-only.
- A second server for acting: two of everything for the same person.
- Groups in the token: stale for up to an hour.
- An orienting `describe_estate` entry: dropped after the prototype, as above.
- `kind` as what tells a concept match from a document match: a concept's kind is an open OKF set, so the layer is named outright.
- *Not company knowledge* as a field on a document match: a field would be a second opinion a caller could disagree with.

## History

The full record, with its amendments (ticket 79 applied by T-001, A26 from prototype 61, T-045, T-134, T-380): `docs/archive/adr/0018-one-mcp-surface-five-entries.md`. Its filename keeps the old count of five so references still resolve.

Later decisions overturned two rules of the record. The connected-clients card showed a pre-registered fallback client id, which ADR 0009's choice of CIMD over registration removed. An Admin raised the spending limit in System until ADR 0047's amendment of 05/10/2026 moved the limit to Models. The argument lint, the revocation check, the scoped `tools/list`, the token's lifetime, the call ceiling, the consent page, the words, the document match's fields, the empty locator, `ask`'s unmapped passages, the citation count, and what is not yet built were missing from this doc until 20/10/2026 (BA-215).
