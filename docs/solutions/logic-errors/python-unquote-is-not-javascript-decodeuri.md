---
title: "Python's unquote is not JavaScript's decodeURI, so the tiers decode one link to two paths"
date: 2026-10-21
category: logic-errors
module: contracts
problem_type: logic_error
component: tier-contract
severity: medium
applies_when:
  - "Decoding a percent-encoded address in the worker that the api or the page also decodes"
  - "Changing `targetOf` in `packages/core/src/store/map/write.ts` or `_target_of` in `apps/worker/src/better_answers_worker/concepts/links/targets.py`"
  - "Adding a percent-encoded case to `contracts/links/cases.json`"
symptoms:
  - "One body link makes a LINKS_TO edge in the api's live map and none in the worker's rebuild, or the reverse"
  - "A link whose address holds `%2F`, `%3F` or a bad escape such as `%zz` resolves in one tier and not the other"
root_cause: wrong_api
resolution_type: code_fix
related_components:
  - map
  - worker
  - web
tags:
  - tier-contract
  - percent-encoding
  - links
  - cross-tier
retire_when: "the two tiers stop each resolving a body link's path, for example if the worker reads the api's derived edges instead of deriving its own"
---

# Python's unquote is not JavaScript's decodeURI, so the tiers decode one link to two paths

## Problem

A body link's path is percent-decoded before it is resolved (BA-146, RFC 3987). The api and the page use JavaScript's `decodeURI`. The worker has no `decodeURI`, and `urllib.parse.unquote` looks like one but reads an address differently in two ways:

- `unquote` decodes every escape. `decodeURI` keeps an escape of `; / ? : @ & = + $ , #` as written, so `roles%2Fboard.md` stays one file name and is not `roles/board.md`.
- `unquote` decodes the good escapes beside a bad one and keeps the bad one. `decodeURI` throws on a `%` that starts no escape, or on escapes that are no UTF-8, and the api then keeps the whole address as written. So `x%zz%C3%A9.md` is `x%zzé.md` in Python and `x%zz%C3%A9.md` in TypeScript.

## Solution

`_uri_decoded` in `links/targets.py` is a hand-written port of `decodeURI`. It decodes escapes one UTF-8 sequence at a time, keeps a reserved character's escape as written, and returns the address unchanged on any escape `decodeURI` would refuse. The TypeScript side is `uriDecoded` in `packages/schema/src/knowledge/concept-file.ts`, which `targetOf` and the page's `concept-body.tsx` both call, so the page and the map read one address one way.

`contracts/links` holds the two differences as cases: *an encoded reserved character stays as written* and *an address that does not decode is read as written*. With `unquote` in place of `_uri_decoded`, those two cases fail and every other case passes.

## Prevention

- Do not use `urllib.parse.unquote` or `unquote_to_bytes` for an address the api also decodes.
- A new decoding rule needs a contract case where the two libraries disagree, not only a case where both decode the same.
- To check a change to `_uri_decoded`, run it and Node's `decodeURI` (with the same fall-back) over random strings made of escapes, reserved escapes, bad escapes and non-ASCII letters, and compare the results. On 21/10/2026, 60,000 such strings agreed, and `unquote` disagreed on 52,039 of them.

## Related

- `docs/solutions/logic-errors/two-tiers-regex-engines-split-lines-and-whitespace-differently.md`, the same class of divergence in the tiers' regular expressions.
