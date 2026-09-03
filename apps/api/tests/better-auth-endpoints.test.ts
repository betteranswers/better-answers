import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";
import { pino } from "pino";
import { afterAll, describe, expect, it } from "vitest";

import { openPostgres } from "@better-answers/core/store/postgres";

import { createAuth, mountedPaths } from "../src/auth/index.ts";
import { HOSTNAME_SURFACES } from "../src/ingress/hostnames.ts";
import { AUTH_SECRET, MCP_URL, PUBLIC_URL } from "./harness.ts";

/**
 * The hostname fence's catch-all under review (T-039).
 *
 * `ingress/hostnames.ts`'s last entry hands `/*` — everything Better Auth mounts at
 * the wildcard — to `app.` without enumerating it, because the set is the
 * plugin list's and a Better Auth upgrade adds to it. That is deliberate, and it means
 * an upgrade can widen the public surface with nobody reading the diff. This suite is
 * the review point: `better-auth-endpoints.txt` is the set as last reviewed, held as
 * plain text so it reads in a PR diff, and the test rebuilds the set and names what
 * was added and what was removed.
 */

const SNAPSHOT = path.join(import.meta.dirname, "better-auth-endpoints.txt");

const HEADER = `\
# Every path Better Auth's configured instance mounts: its own endpoint table, sorted,
# each path once. Read by apps/api/src/auth/endpoints.ts (\`mountedPaths\`), never typed
# out by hand.
#
# This file is the review point for the hostname fence's catch-all entry
# (apps/api/src/ingress/hostnames.ts). That entry gives \`/*\` to \`app.\` — the one
# origin the product, the authorization server and the MCP surface share (ADR 0034) —
# without listing what it admits, because the list is the plugin list's; this is what
# it admitted when a human last looked. A path added here is a path the fence hands to
# that hostname — read it before you commit it, and check it against ADR 0022 and
# ADR 0034. Two classes are refused by configuration rather than by the fence and are
# reviewed here for that reason: the password and sign-up paths (no password or sign-up
# plugin is enabled, and the product never posts to them — sign-in is an email code or
# Microsoft, never a password), and the social paths, which open for Microsoft in its
# own task (ADR 0034).
#
# Refresh:
#   UPDATE_BETTER_AUTH_ENDPOINTS=1 pnpm --filter @better-answers/api exec vitest run tests/better-auth-endpoints.test.ts
#
# A path here is a path to check, not a path that answers: better-call leaves a
# \`SERVER_ONLY\` endpoint off its router and \`disabledPaths\` closes \`/token\`. The list
# keeps them anyway, because neither flag is ours to keep and the day one stops applying
# should be a diff rather than a silence. The reasoning is in
# apps/api/src/auth/endpoints.ts.
#
# Already checked, so nobody need raise it twice: the five \`/admin/oauth2/*\` paths —
# @better-auth/oauth-provider's surface for minting OAuth clients and managing resource
# registrations — are \`SERVER_ONLY\`, so better-call leaves them off its router. They
# answer 404 on \`app.\`, GET and POST, and that is held by a test rather than a claim:
# hostnames.test.ts, "refuses the identity provider's admin endpoints on the one
# hostname that answers". They are listed here because the flag is the library's, not
# because they are reachable.
`;

/** A comment line and a blank line are the header; every other line is one path. */
const readSnapshot = (): readonly string[] =>
  readFileSync(SNAPSHOT, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));

/**
 * The instance `createServer` builds, built the same way — the same `createAuth` with
 * the same options — because which endpoints exist is decided by the plugin list and
 * `basePath`, both of which live in `auth.ts`.
 *
 * Every option is written out again here rather than shared with `server.ts`, so a field
 * added to `AuthDependencies` lands as a type error on this line. It did: `T-037` added
 * `appUrl` and `cookieDomain` while this file was on another branch, and the merge of two
 * green branches was red (`T-040`); `T-045` then removed both. Build them the way
 * `server.ts` does — the one origin, the MCP URL hung off it — or the instance under
 * snapshot is not the instance that deploys.
 *
 * The pool is never connected, and the table does not depend on it. `getEndpoints`
 * builds `auth.api` **synchronously** from `options.plugins` at construction
 * (`better-auth/dist/api/index.mjs`; `router()` registers from that same call), and
 * nothing can add to it later — so the set here is the set a running app carries,
 * whatever the database is doing. Better Auth's eager initialisation does reach for the
 * database and this pool reaches nothing, so that rejection is swallowed here exactly
 * as `createServer` reads it through the health check. Starting a real Postgres would
 * buy this suite a container and no assertion; the guard against a build that carries
 * *no* table is the second test below, not a live connection. (`[TEST2]` binds a test
 * that touches data; this one touches none.)
 */
const database = new Pool({ connectionString: "postgresql://unused@127.0.0.1:1/unused" });
const auth = createAuth({
  database,
  door: openPostgres(database),
  publicUrl: PUBLIC_URL,
  mcpUrl: MCP_URL,
  secret: AUTH_SECRET,
  sendEmail: async () => {},
  fetchClientMetadataResource: async () => new Response("", { status: 404 }),
  logger: pino({ level: "silent" }),
});
auth.$context.catch(() => {});

/**
 * The paths the OAuth flow and the session actually drive (`oauth-flow.test.ts`). A
 * list without them is not this app's instance.
 */
const DRIVEN_BY_THE_FLOW = [
  "/oauth2/authorize",
  "/oauth2/consent",
  "/oauth2/token",
  "/oauth2/revoke",
  "/sign-in/email-otp",
  "/sign-out",
  "/get-session",
  "/jwks",
  "/organization/set-active",
] as const;

/** The catch-all: the entry this snapshot is the review point for. */
const CATCH_ALL = HOSTNAME_SURFACES.at(-1);

afterAll(async () => {
  await database.end();
});

describe("what Better Auth mounts behind the fence's catch-all (ADR 0022, T-039)", () => {
  it("mounts exactly the set the committed snapshot names", () => {
    const mounted = mountedPaths(auth);

    // The test runner's own switch, not the app's configuration: `UPDATE_…=1` rewrites
    // the file so the next commit carries the diff a reviewer reads.
    if (process.env["UPDATE_BETTER_AUTH_ENDPOINTS"] === "1") {
      writeFileSync(SNAPSHOT, `${HEADER}${mounted.join("\n")}\n`);
    }

    const reviewed = readSnapshot();
    // Sorted and each path once, before membership is compared at all: the comparison
    // below is set-shaped, so a hand-edited file with a duplicate or an out-of-order
    // line would pass while breaking the invariant the header states — and the next
    // refresh would produce a diff nobody could read (Cubic round 1).
    expect(
      reviewed,
      "tests/better-auth-endpoints.txt is not sorted, or names a path twice. Refresh it rather than editing it by hand.",
    ).toEqual([...new Set(reviewed)].sort());

    const added = mounted.filter((mount) => !reviewed.includes(mount));
    const removed = reviewed.filter((mount) => !mounted.includes(mount));

    expect(
      { added, removed },
      "Better Auth's mounted set has moved. `added` is a path the fence's catch-all now admits on app. and nobody has reviewed; `removed` is a path something may still call. Read both against ADR 0022 and ADR 0034, then refresh tests/better-auth-endpoints.txt.",
    ).toEqual({ added: [], removed: [] });
  });

  it("refuses to agree with an empty snapshot, so a build that mounts nothing cannot pass", () => {
    // Both sides of the comparison above come from this one build, so a build that had
    // lost its plugins — or its endpoint table entirely — would agree with a snapshot
    // someone had refreshed to match it, and the review point would go quiet.
    const mounted = mountedPaths(auth);

    expect(mounted.length).toBeGreaterThan(0);
    expect(readSnapshot().length).toBeGreaterThan(0);
    for (const path of DRIVEN_BY_THE_FLOW) expect(mounted).toContain(path);
  });

  it("mounts nothing under the share agent's surface, which the catch-all never reaches", () => {
    // ADR 0022: `agent.` is "open and routed only to /agent/v1/*". The fence gives that
    // prefix to `agent.` alone and the catch-all to `app.`, so a Better Auth
    // path under it would be a path the fence hands to the wrong hostname — and one
    // that `agent.`, whose surface has no session, would carry.
    //
    // Both the committed file and the rebuilt set, so an upgrade that mounted one fails
    // here on the same run it fails the diff, not on the run after the refresh.
    for (const mounted of [...readSnapshot(), ...mountedPaths(auth)]) {
      expect(mounted.startsWith("/agent/v1")).toBe(false);
    }
  });

  it("is named by the catch-all entry it reviews, and names that entry back", () => {
    // [TEST7]: one direction finds the fence entry that stopped saying where its set is
    // reviewed, the other the snapshot that stopped saying which fence it is the review
    // point for. Either alone leaves a reader at one end of the pair with nowhere to go.
    expect(CATCH_ALL?.paths).toEqual(["/*"]);
    expect(CATCH_ALL?.reason).toContain("better-auth-endpoints.txt");
    expect(readFileSync(SNAPSHOT, "utf8")).toContain("ingress/hostnames.ts");
  });
});
