import { writeFile } from "node:fs/promises";
import path from "node:path";

import { boundarySchemas, ulid } from "@better-answers/schema";
import { describe, expect, it } from "vitest";

import {
  commit,
  head,
  initRepository,
  withRepositoryLock,
  type CommitRequest,
  type GitDoor,
} from "@better-answers/core/store/git";

import type { ActorId, UserPrincipal } from "../src/kernel/index.ts";
import { bundleHistory, bundlesForSuite, commitFacts, fileAtCommit, staged } from "./bundle.ts";

/**
 * The git door through its own interface (`[TEST1]`), against a real bare repository and no
 * Postgres: what it will put a file at, what one commit's index may see, what a git failure
 * after the precondition comes back as, and what the per-repository lock keeps in order.
 *
 * `concepts.test.ts` proves the same door through an act, which is where the governed write's
 * two-store claims belong. These are the claims a caller of the door can make and an act
 * cannot: the concepts slice narrows a path before the door ever sees one, catches nothing
 * after the precondition, and holds the lock around work of its own.
 */

const bundles = bundlesForSuite();

/**
 * A Principal for a workspace with no membership behind it: the door reads `workspaceId` off
 * it and derives the repository from that, so this suite needs no identity set to run.
 */
const memberOf = (workspaceId: string): UserPrincipal => ({
  kind: "user",
  // Parsed at the boundary rather than asserted (ADR 0028), exactly as the resolver does it.
  workspaceId: boundarySchemas.workspace.select.shape.id.parse(workspaceId),
  userId: boundarySchemas.user.select.shape.id.parse(ulid()),
  role: "Editor",
  groups: [],
  credentialIssuedAtMs: Date.now(),
});

type Bundle = {
  readonly principal: UserPrincipal;
  readonly door: GitDoor;
  readonly workspaceId: string;
};

/** A workspace's bare repository with no commits in it — where every test here opens. */
const arrange = async (): Promise<Bundle> => {
  const workspaceId = ulid();
  const door = bundles();
  await initRepository(door, workspaceId);
  return { principal: memberOf(workspaceId), door, workspaceId };
};

const AUTHOR = { name: "Ada Editor", email: "ada@acme.invalid" } as const;

const requestFor = (overrides: Partial<CommitRequest> = {}): CommitRequest => ({
  path: "knowledge/expenses.md",
  content: "Expenses are claimed within thirty days.\n",
  message: "Record the expenses policy",
  author: AUTHOR,
  trailers: { actor: `human:${ulid()}` satisfies ActorId, audit: ulid() },
  expectedHead: null,
  ...overrides,
});

/** The sha of a commit that was supposed to land; the throw is what a test reads instead of a fallback. */
const shaOf = (committed: Awaited<ReturnType<typeof commit>>): string => {
  if (!committed.ok) throw new Error(`the commit was refused: ${String(committed.error)}`);
  return committed.value.sha;
};

/**
 * The path is what decides where a governed write lands in the bundle's object graph, and it
 * arrives as a caller's string. `..`, a leading slash and an empty segment are each their own
 * case here because each is its own clause of the guard, and a guard proven by one shape is a
 * guard that can lose the others quietly.
 */
describe("what the git door will put a file at", () => {
  it.each([
    ["climbs out of the bundle", "../escape.md"],
    ["climbs out part-way along", "knowledge/../../escape.md"],
    ["is absolute", "/etc/passwd"],
    ["carries an empty segment", "knowledge//expenses.md"],
    ["carries a bare current-directory segment", "knowledge/./expenses.md"],
    ["is empty", ""],
  ])(
    "refuses a path that %s, and leaves the bundle without a commit",
    async (_shape, candidate) => {
      const bundle = await arrange();

      const refused = await commit(bundle.principal, bundle.door, requestFor({ path: candidate }));

      expect(refused).toEqual({ ok: false, error: "malformed-path" });
      expect(await head(bundle.principal, bundle.door)).toBeNull();
      expect(await bundleHistory(bundle.door, bundle.workspaceId)).toEqual([]);
    },
  );

  it("writes a relative path inside the bundle, at every depth", async () => {
    const bundle = await arrange();

    const written = await commit(
      bundle.principal,
      bundle.door,
      requestFor({ path: "knowledge/policy/expenses.md" }),
    );

    const facts = await commitFacts(bundle.door, bundle.workspaceId, shaOf(written));
    expect(facts.files).toEqual(["knowledge/policy/expenses.md"]);
  });
});

describe("one commit's index", () => {
  it("keeps every file the parent commit held", async () => {
    const bundle = await arrange();
    const first = await commit(bundle.principal, bundle.door, requestFor());
    const parent = shaOf(first);

    const second = await commit(
      bundle.principal,
      bundle.door,
      requestFor({
        path: "knowledge/travel.md",
        content: "Travel is booked through the agent.\n",
        expectedHead: parent,
      }),
    );

    const sha = shaOf(second);
    const facts = await commitFacts(bundle.door, bundle.workspaceId, sha);
    expect(facts.files).toEqual(["knowledge/expenses.md", "knowledge/travel.md"]);
    expect(await fileAtCommit(bundle.door, bundle.workspaceId, sha, "knowledge/expenses.md")).toBe(
      "Expenses are claimed within thirty days.\n",
    );
  });

  it("stages in an index of its own, leaving the repository holding none", async () => {
    const bundle = await arrange();

    await commit(bundle.principal, bundle.door, requestFor());

    // A commit that staged in the repository's own index would leave that index behind for
    // the next act to read — which is what makes one act's tree another act's business.
    expect(await staged(bundle.door, bundle.workspaceId)).toEqual([]);
  });
});

/**
 * The arm below the precondition: git refused something after this door decided the write was
 * the caller's to make. A ref that moved is the stale precondition again and is told apart by
 * what git says about it; everything else is the store's failure and comes back as an Error.
 */
describe("a git failure after the precondition passed", () => {
  it("reads a ref it could not lock as the stale precondition it is", async () => {
    const bundle = await arrange();
    // git's own lock file, as a writer that never finished would leave it: `update-ref`
    // refuses the move, and its words are what this door reads the refusal off.
    await writeFile(
      path.join(bundle.door.root, `${bundle.workspaceId}.git`, "refs/heads/main.lock"),
      "",
    );

    const refused = await commit(bundle.principal, bundle.door, requestFor());

    expect(refused).toEqual({ ok: false, error: "stale-precondition" });
  });

  it("hands back the store's own failure when git refuses the write for anything else", async () => {
    const bundle = await arrange();

    // A path this door's guard admits and git's object graph will not hold: no refusal word
    // covers it, so the caller gets the Error to log rather than a word to show a person.
    const failed = await commit(bundle.principal, bundle.door, requestFor({ path: ".git/config" }));

    expect(failed.ok).toBe(false);
    expect(failed.ok ? undefined : failed.error).toBeInstanceOf(Error);
    expect(await head(bundle.principal, bundle.door)).toBeNull();
  });
});

describe("the message the git door composes", () => {
  it("carries all five trailers ADR 0012 fixes when an act names all five", async () => {
    const bundle = await arrange();
    const trailers = {
      actor: `human:${ulid()}` satisfies ActorId,
      audit: ulid(),
      run: ulid(),
      suggestion: ulid(),
      projection: ulid(),
    };

    const written = await commit(bundle.principal, bundle.door, requestFor({ trailers }));

    const facts = await commitFacts(bundle.door, bundle.workspaceId, shaOf(written));
    expect(facts.trailers).toEqual({
      Actor: trailers.actor,
      Audit: trailers.audit,
      Run: trailers.run,
      Suggestion: trailers.suggestion,
      Projection: trailers.projection,
    });
  });

  it.each([
    ["a subject", { message: "" }],
    ["a trailer value", { trailers: { actor: `human:${ulid()}` satisfies ActorId, audit: "" } }],
  ])("refuses %s that is empty, so no commit carries a blank line as one", async (_what, part) => {
    const bundle = await arrange();

    const refused = await commit(bundle.principal, bundle.door, requestFor(part));

    expect(refused).toEqual({ ok: false, error: "malformed-message" });
    expect(await head(bundle.principal, bundle.door)).toBeNull();
  });
});

/** Resolve on demand, so a test decides when the work inside a lock is allowed to finish. */
const gate = (): { readonly waited: Promise<void>; readonly open: () => void } => {
  let open = (): void => {};
  const waited = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { waited, open: () => open() };
};

/** Let every queued microtask and immediate run, so an act that was free to start has started. */
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe("the per-repository lock", () => {
  it("queues a third act behind the second, after the first has left the lock", async () => {
    const bundle = await arrange();
    const order: string[] = [];
    const first = gate();
    const second = gate();
    const secondStarted = gate();

    const a = withRepositoryLock(bundle.principal, bundle.door, async () => {
      order.push("a");
      await first.waited;
    });
    const b = withRepositoryLock(bundle.principal, bundle.door, async () => {
      order.push("b");
      secondStarted.open();
      await second.waited;
    });

    first.open();
    await a;
    await secondStarted.waited;
    // The third act arrives while the second still holds the lock and the first has already
    // run its cleanup: an entry cleared by anyone but its own owner would let this one past.
    const c = withRepositoryLock(bundle.principal, bundle.door, async () => {
      order.push("c");
    });
    await settle();
    expect(order).toEqual(["a", "b"]);

    second.open();
    await Promise.all([b, c]);
    expect(order).toEqual(["a", "b", "c"]);
  });
});
