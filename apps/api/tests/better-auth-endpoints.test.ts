import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { mountedPaths } from "../src/auth/index.ts";
import { HOSTNAME_SURFACES } from "../src/ingress/hostnames.ts";
import { authAsServerBuildsIt } from "./auth-instance.ts";

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
# \`SERVER_ONLY\` endpoint off its router and \`disabledPaths\` closes \`/token\` and
# \`/update-user\`, the second because it would write a display name past the rule
# (update-user.test.ts holds it refused). The list keeps them anyway, because neither
# flag is ours to keep and the day one stops applying should be a diff rather than a
# silence. The reasoning is in apps/api/src/auth/endpoints.ts.
#
# Already checked, so nobody need raise it twice: the five \`/admin/oauth2/*\` paths —
# @better-auth/oauth-provider's surface for minting OAuth clients and managing resource
# registrations — are \`SERVER_ONLY\`, so better-call leaves them off its router. They
# answer 404 on \`app.\`, GET and POST, and that is held by a test rather than a claim:
# hostnames.test.ts, "refuses the identity provider's admin endpoints on the one
# hostname that answers". They are listed here because the flag is the library's, not
# because they are reachable.
`;

const readSnapshot = (): readonly string[] =>
  readFileSync(SNAPSHOT, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));

const { auth, database } = authAsServerBuildsIt();

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

const CATCH_ALL = HOSTNAME_SURFACES.at(-1);

afterAll(async () => {
  await database.end();
});

describe("what Better Auth mounts behind the fence's catch-all", () => {
  it("mounts exactly the set the committed snapshot names", () => {
    const mounted = mountedPaths(auth);

    if (process.env["UPDATE_BETTER_AUTH_ENDPOINTS"] === "1") {
      writeFileSync(SNAPSHOT, `${HEADER}${mounted.join("\n")}\n`);
    }

    const reviewed = readSnapshot();

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

  it("refuses an empty snapshot, so mounting nothing cannot pass", () => {
    const mounted = mountedPaths(auth);

    expect(mounted.length).toBeGreaterThan(0);
    expect(readSnapshot().length).toBeGreaterThan(0);
    for (const path of DRIVEN_BY_THE_FLOW) expect(mounted).toContain(path);
  });

  it("mounts nothing under the share agent's surface", () => {
    for (const mounted of [...readSnapshot(), ...mountedPaths(auth)]) {
      expect(mounted.startsWith("/agent/v1")).toBe(false);
    }
  });

  it("names the catch-all entry it reviews, which names it back", () => {
    expect(CATCH_ALL?.paths).toEqual(["/*"]);
    expect(CATCH_ALL?.reason).toContain("better-auth-endpoints.txt");
    expect(readFileSync(SNAPSHOT, "utf8")).toContain("ingress/hostnames.ts");
  });
});
