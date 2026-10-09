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

- The Principal comes from the token. No entry takes a workspace.
- The MCP surface grows by token scope, never by a second server. The scopes today are `knowledge:read` and `feedback:write`.

`find`'s match is a union by knowledge layer.

- A concept match (`layer: "bundles"`) sits beside a document match (`layer: "sources"`), which the rendering marks *Not company knowledge*.
- A document that a concept visible to the caller cites is left out.
- The caller's limit is spent on the union: concepts holding at least half the query's words first, then document matches, then the remaining concepts (owner, 09/10/2026).
- The two arms share no score. Each is ranked on its own, first by how many of the query's words a row holds, then by its full-text rank.

`open` takes one IRI or one wire locator.

- A concept's evidence item carries its source.
- It carries the locator that opens its passage only where the source gives one.

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

## History

The full record, with its amendments (ticket 79 applied by T-001, A26 from prototype 61, T-045, T-134, T-380): `docs/archive/adr/0018-one-mcp-surface-five-entries.md`. Its filename keeps the old count of five so references still resolve.
