---
title: "The model client is one fetch-shaped seam with a registry of wire shapes"
date: 2026-10-13
module: packages/core
problem_type: architecture_pattern
component: llm
severity: high
applies_when:
  - "Calling a model from the api tier, for any purpose"
  - "Adding a provider, a model host or a wire shape a model choice can name"
  - "Proposing a provider's SDK, a gateway library or a second path to a model"
  - "Testing code that calls a model"
tags:
  - adr-0049
  - model-client
  - wire-shape
  - model-choice
  - decision-model
  - messages-api
  - workers-ai
  - llm-call
---

# The model client is one fetch-shaped seam with a registry of wire shapes

## The decision

Every model call the api tier makes goes through the model client, one fetch-shaped seam in core's `llm` layer.

- **A registry of wire shapes**, keyed by a model choice's provider. A wire shape turns a typed call into a request and a response into an outcome. Anthropic speaks the Messages API and Cloudflare the decision shape. The client has one method per shape, and it sends a model of the other shape nothing.
- **Two shapes.** The Messages API comes first, with a streamed form for the drafter. One decision-model shape comes second: a state, and one true-or-false question per candidate, each answered with a probability of yes. TypeSafe, Workers AI and a self-hosted Clef share that request body. The URL, the key and the reply's envelope are Workers AI's, so a second host would be a second provider in the registry, reusing the body.
- **A decision call never exceeds its model's window.** Workers AI truncates an overlong state silently, so the client counts the request at three bytes a token against the window its vendor publishes for the model. It sends nothing over the window, and nothing to a model with no published window. The judge's state is the question, and each candidate sits in its own question.
- **A Workers AI key carries its account.** Cloudflare names the account in the URL, so the key is the account id, a colon, then the API token. It is refused in any other form when it is set, and never at call time.
- **A decision model judges at a threshold** stored in config for each provider and model. A probability at the threshold is a yes. A model with no stored threshold is never called, and its judging fails. No threshold is stored until the owner's reading calibrates one.
- **The fetch function is injected** through the server's dependencies, as the client-metadata fetcher is. A test passes a fake at the wire, and our own code is never mocked. No provider's SDK is added.
- **An outcome is one of five:** answered with usage, rate limited, the provider's spend cap, refused, or failed. A provider's spend cap is told apart from a rate limit, because waiting does not lift it; a billing fault reads as a spend cap for the same reason, whether the provider sends it as a billing status or as a bad request saying the account's credit has run out.
- **A call's attempts fit its reservation.** The client tries again only an attempt that spent nothing: a rate limit or the provider's fault. Each attempt's `max_tokens` is the output its reservation holds. Every attempt's timeout and every wait between them end inside the reservation's life, so the sweep never settles a call still running.
- **A caller may give the whole call a deadline.** Every attempt and wait then ends inside it, and a retry it leaves no room for is not made. The judge's is 150 seconds, under the 240 seconds claude.ai and Claude Desktop give a remote MCP tool call; a judge out of time returns evidence.
- **The client names the model a model choice names and no other.** It never substitutes a model at run time.
- **Every call sits behind the redaction seam and the typed-text check** (ADR 0020). The client answers what each attempt spent, and the caller settles them as `llm_call` rows, one per attempt (ADR 0025). No prompt and no completion is logged, stored or returned beyond the caller.
- **In `check` the client is faked.** A test asserts the shape of a call and of a result, never a model's judgement. A reading with a real model is a run the owner starts, over synthetic content, and its figures are recorded on the route.

A decision model is measured before any workspace is set to run it. The generative judge ships first, and the decision-model backend ships unselected.

## Why

- A decision model does not speak the Messages API. It answers a typed question with a probability for each allowed answer and writes no text, so a client of one shape could not call it.
- The decision-model class was released in September 2026, and every benchmark seen for it is its vendor's own. The owner wants it measured on reuse and at the entry step, and a measure needs the product's own judge to call it.
- A fake at the wire tests the code that builds a request and reads a response. A mocked SDK tests the mock.
- A local model and a hosted one take one code path when the seam is a fetch.
- The api tier makes its first outbound call on a person's request here. One seam is one place for timeouts, retries and spend to be sized together.

## Rejected

- The Messages API alone, which the route leaned towards: a decision model does not speak it.
- A provider's SDK, or a gateway library that speaks many: a second path to a model beside the seam, and nothing a test can fake at the wire.
- A decision model alone for the judge, or a generative judge alone: the first rests on vendor benchmarks, and the second leaves the class unmeasured.
- A shape per vendor: three hosts already share one decision-model request shape.
- Falling back to another model when a call fails: a judgement nobody chose, at a price nobody set.
- Candidates in the decision call's state: the provider would cut them silently past the window, where questions over it are refused.
- A second key column for the Workers AI account: a migration, and a second secret's handling, for an id that is no secret.

What is given up: two wire shapes are kept in step with their vendors by hand, with no SDK's retries, typed errors or streaming helpers.

## History

Written 13/10/2026 on the owner's decisions of 11/10/2026, by the S2b ask plan (`docs/plans/2026-10-11-2309-feat-s2b-ask-plan.md`, R29 and KTD10). The route named the wire shape as S2b's decision, leaning towards the Messages API alone (`docs/specs/v01-route.md`, the S2b block). ADR 0041 holds how a provider's key is kept, and ADR 0025 what an `llm_call` row holds.

Amended 15/10/2026 by the plan's U15, which built the decision shape on Workers AI. It added Cloudflare as a model provider and the window, key and threshold rules above, read from Cloudflare's Clef and Clef-flash model pages that day: windows of 65,536 and 24,576 tokens, a state that is truncated to fit, and no charge for output.
