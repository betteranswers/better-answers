# Lift: `@better-auth/cimd/node` — `fetchClientMetadataResource`

Upstream: https://github.com/better-auth/better-auth, package `@better-auth/cimd` 1.7.5, file `packages/cimd/src/node.ts` (published as `dist/node.mjs`).
Upstream commit (tag `v1.7.5`): `5468e6bfcdff799848537cf5ad06ebab15aad9dd`.
Snapshot digest (sha256 of the published `dist/node.mjs` this lift was written against): `fb03788e51d54dbd78dd2ce4f3fcc5b56a84546dd604f4e0532d8951a3712ba7`.
Licence: MIT (ADR 0027; the notice text is below).
Lifted: 2026-09-01, T-004. Refreshed onto 1.7.5: 2026-09-26, T-420, audited by the T-420 builder against the published `dist/node.mjs` and `src/node.ts` at the tag above.

## Why it is lifted

1.7.2 answered Node's `lookup` in the single-address form only, and 1.7.5 fixed that (better-auth/better-auth#10730). Two gaps remain in 1.7.5's transport, and a wrapper outside it cannot close either:

- **An out-of-range status crashes the process.** The transport builds the `Response` inside the request callback. `new Response` throws a `RangeError` for a status outside 200–599, such as `HTTP/1.1 999`, and nothing catches it there. better-auth/better-auth#11422.
- **The address lookup ignores the abort signal.** The transport calls `dns/promises` `lookup` without the caller's signal, so a stalled resolver holds the fetch past the plugin's deadline. better-auth/better-auth#11423.

## What was changed

The code is upstream 1.7.5's, with these differences only:

- **The status guard.** Building the `Response` is wrapped. A throw destroys the response and rejects with a `TypeError`, as `fetch` does for a network error.
- **The signal-aware lookup.** The signal is read before the lookup. An aborted signal refuses at once, and the lookup races the signal's `abort` and rejects with its reason. An abandoned lookup keeps its thread-pool thread until it settles, so it still counts against a bound of 32 lookups in flight, and a lookup past the bound is refused.
- **The seams.** The resolver and the request function are parameters of `createClientMetadataFetcher`, defaulting to Node's, so the tests reach the policy without the network. The resolver answers `{ address, family }` pairs; the default wraps `dns/promises` `lookup` with upstream's `{ all: true, verbatim: true }`.
- `statusText` falls back to `""` where upstream passes `undefined`, which `Response` reads the same way. It exists only for this tier's `exactOptionalPropertyTypes`.

Nothing else is the lift's. The deadline, the body cap, the non-200 refusal, the concurrency bound and the cache per `client_id` are the CIMD plugin's; the `jwks_uri` deadline and cap are the OAuth provider's (ADR 0009, 2026-09-26 amendment).

## Removal condition

Remove this directory and import `fetchClientMetadataResource` from `@better-auth/cimd/node` when a released `@better-auth/cimd` fixes both better-auth/better-auth#11422 and better-auth/better-auth#11423.

## The test a refresh must pass

`apps/api/tests/cimd-fetch.test.ts`: both lookup shapes, the pin with Host and SNI (none for an address literal), the caller's signal handed on, the reply as upstream builds it (body, no body for HEAD, 204 and 304, repeated headers, the request's own error), the refusal paths (scheme, method, every non-public address class, a private answer behind a public one, no answers), the redirect returned unfollowed, and the two guards. Each guard's test fails against the unguarded transport: the status test on the uncaught `RangeError`, the lookup tests on a fetch that never settles. `apps/api/tests/oauth-flow.test.ts` ("fetches a keyed client's jwks_uri through the metadata fetcher") holds that the server's one fetcher serves the metadata document and `jwks_uri` both.

## Upstream notice

MIT License

Copyright (c) 2024 Better Auth

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
