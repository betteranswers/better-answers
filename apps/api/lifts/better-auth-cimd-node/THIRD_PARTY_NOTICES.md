# Lift: `@better-auth/cimd/node` — `fetchClientMetadataResource`

## Why it is lifted

Two gaps in 1.7.7's transport:

- **An out-of-range status crashes the process.** The transport builds the `Response` inside the request callback. `new Response` throws a `RangeError` for a status outside 200–599, such as `HTTP/1.1 999`, and nothing catches it there. better-auth/better-auth#11422.
- **The address lookup ignores the abort signal.** The transport calls `dns/promises` `lookup` without the caller's signal, so a stalled resolver holds the fetch past the plugin's deadline. better-auth/better-auth#11423.

## What was changed

Differences from upstreams 1.7.7:

- **The status guard.** Building the `Response` is wrapped. A throw destroys the response and rejects with a `TypeError`, as `fetch` does for a network error.
- **The signal-aware lookup.** The signal is read before the lookup. An aborted signal refuses at once, and the lookup races the signal's `abort` and rejects. An abandoned lookup keeps its thread-pool thread until it settles, so it still counts against a bound of 32 lookups in flight.
- **The seams.** The resolver and the request function are parameters of `createClientMetadataFetcher`, defaulting to Node's, so the tests reach the policy without the network. The resolver answers `{ address, family }` pairs; the default wraps `dns/promises` `lookup` with upstream's `{ all: true, verbatim: true }`.
- `statusText` falls back to `""` where upstream passes `undefined`. It exists only for this tier's `exactOptionalPropertyTypes`.

## Removal condition

Remove this directory and import `fetchClientMetadataResource` from `@better-auth/cimd/node` when a released `@better-auth/cimd` fixes both better-auth/better-auth#11422 and better-auth/better-auth#11423.

## Upstream notice

MIT License

Copyright (c) 2024 Better Auth

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
