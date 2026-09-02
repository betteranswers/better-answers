# Lift: `@better-auth/cimd/node` — `fetchClientMetadataResource`

Upstream: https://github.com/better-auth/better-auth, package `@better-auth/cimd` 1.7.2, file `packages/cimd/src/node.ts` (published as `dist/node.mjs`).
Upstream commit (tag `v1.7.2`): `ba12fcdfa774ca27d417079dbac0b1b5894ccaf2`.
Snapshot digest (sha256 of the published `dist/node.mjs` this lift was written against): `905c3227fd0d3509a1ff2acf905a43f4bf5865c689c20770224d25c554e819b1`.
Licence: MIT (`[LIFT3]`; the notice text is below).
Lifted: 2026-09-01, T-004. Audited by the T-004 builder against prototype 61's fix (`.scratch/v01-spec/prototypes/61-claude-connector/src/cimd-fetch.ts`) and research 80 F7.

## Why it is lifted

Upstream's transport answers Node's `lookup` in the single-address form only. Since Node 20, `autoSelectFamily` calls `lookup` with `{ all: true }` and expects an array, so on Node 24 (ADR 0006) every fetch throws `ERR_INVALID_IP_ADDRESS` before a packet leaves the machine and every CIMD authorization fails `invalid_client` — the mechanism claude.ai prefers (research 80 §4). Upstream issue better-auth/better-auth#10810 (open); fix PR better-auth/better-auth#10730 (open, against `next`).

## What was changed

- The `lookup` callback honours the `all` flag Node passes (the fix).
- The SSRF policy ADR 0009's 2026-08-30 amendment owns, in the same code: https only; GET/HEAD only; every resolved address refused if not public-routable (upstream's `isPublicRoutableHost` — private, loopback, link-local, CGNAT/shared address space, documentation, multicast, and the 6to4/NAT64/Teredo forms that embed one); the address pinned for the connection with the original Host and SNI; redirects returned and never followed (cap 0); a 10-second timeout; a 64 KB response cap; a per-host answer cache.
- Dependencies (resolver, request function, limits) are constructor parameters so the policy is testable without the network.

## Removal condition

Remove this directory and import `fetchClientMetadataResource` from `@better-auth/cimd/node` when a released `@better-auth/cimd` carries better-auth/better-auth#10730 (or an equivalent fix that answers `{ all: true }`). The SSRF additions beyond upstream — the timeout, the response cap, the per-host cache — stay with the platform: if upstream still lacks them at removal, they wrap the upstream transport instead.

## The test a refresh must pass (`[APP4]`)

`apps/api/tests/cimd-fetch.test.ts` — the refusal paths (scheme, method, every non-public address class, timeout, cap, redirect not followed) and the two lookup shapes.

## Upstream notice

MIT License

Copyright (c) 2024 Better Auth

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
