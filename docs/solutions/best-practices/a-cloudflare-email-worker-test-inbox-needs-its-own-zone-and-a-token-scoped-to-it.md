---
title: "A Cloudflare Email Worker test inbox needs a zone of its own, and its deploy token reaches every zone in the account"
date: 2026-10-03
category: best-practices
module: apps/test-inbox
problem_type: best_practice
component: testing-framework
severity: high
applies_when:
  - "Giving CI journeys a way to read sign-in emails without a credential that can read real people's mail"
  - "Turning on Cloudflare Email Routing for a testing address range on a zone whose apex already receives mail elsewhere"
  - "Switching a catch-all rule from one Email Worker to another, or deleting the Worker a rule last pointed at"
  - "Scoping a Cloudflare API token that deploys Workers in an account that also holds the product's zone"
  - "Adding a Cloudflare Worker to a pnpm monorepo, or testing Worker code and D1 reads in Node vitest"
symptoms:
  - "Email Routing on a subdomain of the product zone required the apex's MX records, which would have replaced Google Workspace mail"
  - "A check email sent about 40 s after a catch-all switch showed Delivery failed and reached the new Worker only after a retry about 6 minutes later"
  - "A token with Workers Scripts edit and no zone permission could still attach a Worker to a custom domain under any zone in the account"
  - "Adding @cloudflare/workers-types made pnpm resolve it as an optional peer of drizzle-orm, pulling it into the api image"
related_components:
  - identity
  - development-workflow
tags:
  - cloudflare
  - email-routing
  - email-worker
  - test-inbox
  - catch-all
  - dkim
  - d1
  - wrangler
---

# A Cloudflare Email Worker test inbox needs a zone of its own, and its deploy token reaches every zone in the account

## Context

The journeys' test inbox is a free Cloudflare Email Worker on a testing domain of its own, chosen over a second, paid Resend team. The nightly sign-in journeys must read an email sign-in code through an API. A Resend key that reads received mail must be a full-access key, and a full-access key can also list and retrieve the team's sent mail, so a key in production's team could read any person's sign-in code (`docs/plans/2026-10-02-1625-feat-signed-in-journeys-in-production-plan.md`, Sources / Research).

The Worker is `apps/test-inbox`, with the journeys' reader in `apps/web/journeys/inbox.ts`. Both were built in PR #530 (BA-34 U9 and U10), which is unmerged as of 03/10/2026.

This doc covers what building it taught: where Email Routing can live, what the Worker may trust, what its deploy token can reach, and how a Worker builds and tests in this pnpm monorepo.

## Guidance

### Put the inbox on a zone of its own, with one catch-all on its apex

Email Routing could not go on a subdomain of the product's zone without switching it on at the product's apex. The dashboard's Email Routing Settings page lists the apex's three Cloudflare MX records as required, and says "Subdomains are dependent on the domain. If the domain is disabled, subdomains will be disabled too." The product's apex already takes the owner's mail through another provider, so switching Email Routing on there would have replaced that mail.

A catch-all works only on an apex: "Catch-all entries support apex domains only" (https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/). On a subdomain each address of the test workspace's 54 people would need a rule of its own.

So the testing domain was bought at Cloudflare Registrar, which makes it a zone of its own. Email Routing is on at its apex, with one catch-all rule whose action is "Send to a Worker" `test-inbox`, and no rule per address (`docs/operations/RUNBOOK.md:164`, `:181`). The product's zone is untouched.

### Never delete the Worker a catch-all last pointed at until mail reaches the new one

A change to the catch-all takes about a minute to reach Email Routing. In PR #530 the rule was switched from the spike Worker to `test-inbox`, and the spike Worker was deleted about 20 seconds later. A check message sent about 40 seconds after the switch read "Delivery failed" in the zone's Email Routing activity log, and `test-inbox`'s logs held no email invocation for it. The sending relay (Amazon SES, under Resend) retried, and the message arrived about six minutes after it was sent. Resend still showed it as sent, with no bounce.

The rule is now in `RUNBOOK.md:181`: after repointing the rule, send a message, see the new Worker list it, and only then delete the old Worker. A bounce costs more than a delay. A sign-in email that bounces puts the test address on production's Resend suppression list, and every later night reads `no-mail` (`RUNBOOK.md:191`).

### Store the raw bytes in the Worker; judge them in the reader

The Worker keeps `message.raw` whole and judges nothing. `receive` (`apps/test-inbox/src/index.ts:39-62`) drops any message whose `rawSize` is over 256 KiB (`RAW_MOST_BYTES`, `:15`), then reads the raw stream once. It inserts the message, prunes rows more than a day old (`RETENTION_MS`, `apps/test-inbox/src/store.ts:46`), and on any failure logs it and returns. It never calls `setReject` or `forward`, because "a bounce would put the test address on the sender's suppression list" (`index.ts:35-38`). From `message.headers` it reads only `From` and `Subject`, for the list (`index.ts:27-33`).

The journeys' reader verifies DKIM itself, in Node in CI, with mailauth's `dkimVerify` on the raw bytes (`apps/web/journeys/inbox.ts:5`, `:234`; mailauth 7.1.0, `apps/web/package.json:56`). Its resolver answers only for keys under the sender's own `_domainkey` and refuses every other name with `ENODATA`. Otherwise a forger's extra signatures could keep it waiting on DNS until the deadline passed (`sendersOwn`, `inbox.ts:132-141`). A signature counts only if it passes, its `d=` is the sender's domain, it covers the whole body with no `l=`, and its signed headers include `To` (`vouches`, `inbox.ts:191-195`). A message with more than one `From` or `To` is set aside (`singlyAddressed`, `inbox.ts:201-202`).

The spike in PR #530 showed that the bytes survive the trip. A throwaway Worker on the catch-all logged the names in `message.headers` and the whole `message.raw`, base64, through `wrangler tail`. A message sent through production's Resend account arrived byte for byte: 5,328 bytes, delivered in under a second, using 1 ms of CPU and 3 ms of wall time. It carried two `DKIM-Signature` headers. Resend's has `d=` set to the product's apex and an `h=` of `From:To:Subject:Message-ID:Date:MIME-Version:Content-Type`. Amazon SES's has `d=amazonses.com`. Cloudflare's own `Authentication-Results` read DKIM pass for both, with DMARC and SPF passing too. Offline, mailauth verified the product's signature, aligned with `From`, and DMARC passed. Because Resend's `h=` includes `To`, `vouches` can require it.

cloudflare/workerd#6740 (https://github.com/cloudflare/workerd/issues/6740, open as of 03/10/2026) reports `Authentication-Results`, `Received` and `DKIM-Signature` missing from `message.headers`. Its example is a message forwarded through Gmail. The spike's message was sent direct, and its `message.headers` held all three. The design depends on neither case: the Worker reads no authentication header, and the reader checks the signed bytes against DNS. Do not move a trust decision into the Worker on the strength of Cloudflare's `Authentication-Results`.

### Treat the deploy token as a credential to the product's hostnames

The deploy token is an account-owned API token. It has Workers Scripts edit, D1 edit, Workers Tail read and Account Settings read, and no zone permission (`RUNBOOK.md:166`).

Having no zone permission does not keep it off the product's zone. Attaching a Worker to a custom domain is `PUT /accounts/{account_id}/workers/domains`, and Cloudflare's API reference gives "Workers Scripts Write" as its only permission (https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/update/). The token can therefore put a Worker on a new hostname under any zone in the account, the product's included.

`docs/operations/SECRETS.md:32` holds the token at that weight. After a leak, the owner lists every Worker's domains and routes and deletes any they did not make (`RUNBOOK.md:279`). `wrangler login` is never used, because its default grant can write Worker routes across the account (`RUNBOOK.md:166`). A Cloudflare account holding the testing zone alone would close the gap. That choice is the owner's, and it is still open.

### Build the Worker without `@cloudflare/workers-types` and without a `wrangler` dependency

Adding `@cloudflare/workers-types` as a dev dependency made pnpm resolve it as an optional peer of `drizzle-orm` in `apps/api` and `packages/schema`, which put it in the api image. An override only widened the peer range. So the workspace has no such dependency (`apps/test-inbox/package.json:15-20`). Instead it declares the few shapes it uses: the part of `ForwardableEmailMessage` it reads (`apps/test-inbox/src/index.ts:7-13`) and the D1 calls the store makes (`apps/test-inbox/src/store.ts:3-17`).

`wrangler` is not a dependency either. One script pins it, and `deploy` runs through that script, so the version is stated once (`apps/test-inbox/package.json:12-13`). Run it as `pnpm --filter @better-answers/test-inbox run deploy`. A bare `pnpm deploy` is pnpm's own command, which copies a workspace package to a target directory (https://pnpm.io/cli/deploy; `RUNBOOK.md:179`).

The config names the D1 database and carries no `database_id` (`apps/test-inbox/wrangler.jsonc:9-15`). wrangler 4.147.0 made the database by that name on the first deploy. In PR #530 it did not write the id back to `wrangler.jsonc`, although Cloudflare's docs say a local deploy does (https://developers.cloudflare.com/workers/wrangler/configuration/, Automatic provisioning). The deploy applies no migration, so `wrangler d1 migrations apply test-inbox --remote` runs after it (`RUNBOOK.md:174`). Until it runs, the Worker logs each message as unstored and its API answers 503 (`RUNBOOK.md:168`).

### Write Worker code that also runs under Node's vitest

The suites run in Node 24, not workerd, so the Worker uses only APIs both runtimes have. Workers offer `crypto.subtle.timingSafeEqual` as a non-standard extension (https://developers.cloudflare.com/workers/runtime-apis/web-crypto/), and Node 24's `crypto.subtle` lacks it. The token check therefore hashes the offered and the expected token with SHA-256 and XOR-folds the two 32-byte digests, admitting only an all-zero result (`admits`, `apps/test-inbox/src/read-api.ts:52-62`). Tokens of different lengths neither throw nor reveal their length.

D1 returns a BLOB as a JavaScript Array made with `Array.from` (https://developers.cloudflare.com/d1/worker-api/, type conversion), while `node:sqlite` returns a `Uint8Array`. The D1 stand-in converts as D1 does, so the suites meet the shape production returns (`columnOf`, `apps/test-inbox/test/d1.ts:8-12`). The store accepts all three byte shapes (`Column`, `apps/test-inbox/src/store.ts:3-4`; `bytesOf`, `:70-74`). If the stand-in passed a `Uint8Array` straight through, a store that handled only `Uint8Array` would pass every test and fail on its first real read.

## Why This Matters

- With a Resend key that could read the inbox, the journeys could read every person's sign-in code. The Worker's key reads one inbox, which holds a day of test mail (`SECRETS.md:27`).
- Email Routing on the product's apex would have replaced the owner's mail.
- One bounce puts a test address on production's suppression list, and every night reads `no-mail` until someone removes it (`RUNBOOK.md:191`, `:264`). A Worker deleted while the catch-all is still changing causes that bounce, and so does a Worker that rejects.
- A trust decision in the Worker would rest on headers that workerd#6740 shows can be missing. The reader's DKIM check rests on the bytes the sender signed.
- A token with no zone permission still reaches the product's hostnames. If a leak of it is treated as narrower than that, nobody checks those hostnames for a planted Worker.
- `@cloudflare/workers-types` in one workspace changed what the api image installs, by way of another package's optional peer.
- A Node stand-in that differs from D1 in one return type hides a production failure behind a passing test.

## When to Apply

- Adding Email Routing, a catch-all or an Email Worker to any zone in this account.
- Changing which Worker a catch-all sends to, or deleting a Worker that receives mail.
- Making, rotating or judging the reach of a Cloudflare API token for a Worker deploy.
- Adding another Cloudflare Worker workspace to this monorepo, or any dev dependency that another workspace could pick up as an optional peer.
- Testing Worker code under Node's vitest, above all code that uses a `crypto.subtle` extension or reads a D1 BLOB.
- Any proposal to judge received mail (DKIM, DMARC, the sender) in the Worker instead of the reader.

## Examples

The token check, which runs the same in the Worker and in Node (`apps/test-inbox/src/read-api.ts:52-62`):

```ts
const digestOf = async (text: string): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));

const admits = async (authorization: string | null, token: string): Promise<boolean> => {
  const offered = BEARER.exec(authorization ?? "")?.[1];
  if (offered === undefined) return false;
  const [given, expected] = await Promise.all([digestOf(offered), digestOf(token)]);
  const difference = given.reduce((folded, byte, at) => folded | (byte ^ (expected[at] ?? 0)), 0);
  return difference === 0;
};
```

The stand-in returns a BLOB as D1 does (`apps/test-inbox/test/d1.ts:8-12`), and the store reads any of the shapes (`apps/test-inbox/src/store.ts:70-74`):

```ts
// test/d1.ts
const columnOf = (value: SQLOutputValue): Column => {
  if (value instanceof Uint8Array) return Array.from(value);
  return typeof value === "bigint" ? Number(value) : value;
};

// src/store.ts
const bytesOf = (column: Column | undefined): Uint8Array | undefined => {
  if (column instanceof Uint8Array) return column;
  if (column instanceof ArrayBuffer) return new Uint8Array(column);
  return Array.isArray(column) ? Uint8Array.from(column) : undefined;
};
```

The pinned `wrangler`, and a `deploy` that must be run through `run` (`apps/test-inbox/package.json:12-13`):

```json
"wrangler": "pnpm dlx wrangler@4.147.0",
"deploy": "pnpm run wrangler deploy"
```

The D1 connected source by name, with no `database_id` (`apps/test-inbox/wrangler.jsonc:9-15`):

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "test-inbox",
    "migrations_dir": "migrations",
  },
],
```

The first deploy, in order, with the token and account id exported first as `RUNBOOK.md:171-172` does (`RUNBOOK.md:173-176`, abridged):

```sh
pnpm --filter @better-answers/test-inbox run deploy
pnpm --filter @better-answers/test-inbox run wrangler d1 migrations apply test-inbox --remote
pnpm --filter @better-answers/test-inbox run wrangler secret put READ_TOKEN
```

Moving the catch-all to a new Worker:

1. Deploy the new Worker.
2. Point the catch-all at it in the zone's Email Routing.
3. Send a message to an address on the testing domain that is none of the test people's, and see the new Worker list it.
4. Only then delete the old Worker.

## Related

- `docs/plans/2026-10-02-1625-feat-signed-in-journeys-in-production-plan.md`: KTD3 (the test inbox's form) and KTD18 to KTD20 (the Worker stores and judges nothing; the reader verifies DKIM; deployed by hand), units U9 and U10.
- `docs/operations/RUNBOOK.md` page 13 (the owner's setup, go/no-go and leak steps) and `docs/operations/SECRETS.md` (the read token and the deploy token).
- `docs/solutions/architecture-patterns/adr-0029-apps-over-packages-capability-slices.md`: why `apps/test-inbox` is a second TypeScript deployable.
- `docs/solutions/architecture-patterns/adr-0034-one-origin-product-and-authorization-server.md`: a Worker planted on a hostname under the product's zone would also trip its `__Host-` cookie trigger.
- `docs/solutions/architecture-patterns/adr-0027-open-core-under-apache-2-0.md`: the testing domain, the account and the Worker's URL stay out of public files.
