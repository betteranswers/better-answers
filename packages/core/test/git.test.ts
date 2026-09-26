import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ANY_HEAD,
  commit,
  commitsAfter,
  fileAt,
  head,
  historyNaming,
  initRepository,
  openGit,
  withRepositoryLock,
  type CommitRequest,
  type GitDoor,
} from "@better-answers/core/store/git";
import { boundarySchemas, ulid } from "@better-answers/schema";

import type { ActorId, PlatformPrincipal, UserPrincipal } from "../src/kernel/index.ts";
import {
  bundleHistory,
  bundlesForSuite,
  commitFacts,
  corruptPackedRefs,
  fileAtCommit,
  objectRemovedFrom,
  staged,
} from "./bundle.ts";
import { gitStarts } from "./git-starts.ts";

const bundles = bundlesForSuite();

const memberOf = (workspaceId: string): UserPrincipal => ({
  kind: "user",

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
  at: new Date(),
  ...overrides,
});

const shaOf = (committed: Awaited<ReturnType<typeof commit>>): string => {
  if (!committed.ok) throw new Error(`the commit was refused: ${String(committed.error)}`);
  return committed.value.sha;
};

describe("opening the git door", () => {
  it("refuses an empty root at open", () => {
    expect(openGit("")).toEqual({ ok: false, error: "root-not-absolute" });
  });

  it("refuses a relative root at open", () => {
    expect(openGit("relative/git-store")).toEqual({ ok: false, error: "root-not-absolute" });
  });

  it("refuses a root that does not exist as a directory", () => {
    const absent = path.join(tmpdir(), `better-answers-no-such-root-${ulid()}`);

    expect(openGit(absent)).toEqual({ ok: false, error: "no-such-root" });
  });
});

describe("what the git door will put a file at", () => {
  it.each([
    ["escapes the bundle", "../escape.md"],
    ["climbs out part-way along", "knowledge/../../escape.md"],
    ["is absolute", "/etc/passwd"],
    ["carries an empty segment", "knowledge//expenses.md"],
    ["carries a `.` segment", "knowledge/./expenses.md"],
    ["is empty", ""],

    ["carries a tab", "knowledge/ex\tpenses.md"],
    ["carries a newline", "knowledge/ex\npenses.md"],
  ])("refuses a path that %s, committing nothing", async (_shape, candidate) => {
    const bundle = await arrange();

    const refused = await commit(bundle.principal, bundle.door, requestFor({ path: candidate }));

    expect(refused).toEqual({ ok: false, error: "malformed-path" });
    expect(await head(bundle.principal, bundle.door)).toBeNull();
    expect(await bundleHistory(bundle.door, bundle.workspaceId)).toEqual([]);
  });

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

  it("starts one rev-parse, then the plumbing, on a parent", async () => {
    const bundle = await arrange();
    const expectedHead = shaOf(await commit(bundle.principal, bundle.door, requestFor()));

    const started = await gitStarts(() =>
      commit(bundle.principal, bundle.door, requestFor({ path: "knowledge/b.md", expectedHead })),
    );

    expect(started).toEqual([
      "rev-parse",
      "read-tree",
      "hash-object",
      "update-index",
      "write-tree",
      "commit-tree",
      "update-ref",
    ]);
  });

  it("lands on the standing head when it expects any head", async () => {
    const bundle = await arrange();
    const first = shaOf(await commit(bundle.principal, bundle.door, requestFor()));

    const second = await commit(
      bundle.principal,
      bundle.door,
      requestFor({ path: "knowledge/b.md", expectedHead: ANY_HEAD }),
    );

    expect(second).toEqual({ ok: true, value: { sha: expect.any(String), parent: first } });
    expect(await bundleHistory(bundle.door, bundle.workspaceId)).toEqual([first, shaOf(second)]);
  });

  it("lands a first commit when it expects any head", async () => {
    const bundle = await arrange();

    const first = await commit(
      bundle.principal,
      bundle.door,
      requestFor({ expectedHead: ANY_HEAD }),
    );

    expect(first).toEqual({ ok: true, value: { sha: expect.any(String), parent: null } });
    expect(await head(bundle.principal, bundle.door)).toBe(shaOf(first));
  });

  it("stages in its own index, leaving the repository without one", async () => {
    const bundle = await arrange();

    await commit(bundle.principal, bundle.door, requestFor());

    expect(await staged(bundle.door, bundle.workspaceId)).toEqual([]);
  });
});

describe("a git failure after the precondition passed", () => {
  it("reads an unlockable ref as a stale precondition", async () => {
    const bundle = await arrange();

    await writeFile(
      path.join(bundle.door.root, `${bundle.workspaceId}.git`, "refs/heads/main.lock"),
      "",
    );

    const refused = await commit(bundle.principal, bundle.door, requestFor());

    expect(refused).toEqual({ ok: false, error: "stale-precondition" });
  });

  it("hands back the store's failure for any other refused write", async () => {
    const bundle = await arrange();

    const failed = await commit(bundle.principal, bundle.door, requestFor({ path: ".git/config" }));

    expect(failed.ok).toBe(false);
    expect(failed.ok ? undefined : failed.error).toBeInstanceOf(Error);
    expect(await head(bundle.principal, bundle.door)).toBeNull();
  });
});

describe("the message the git door composes", () => {
  it("carries all five trailers when an act names them all", async () => {
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
  ])("refuses %s that is empty, committing nothing", async (_what, part) => {
    const bundle = await arrange();

    const refused = await commit(bundle.principal, bundle.door, requestFor(part));

    expect(refused).toEqual({ ok: false, error: "malformed-message" });
    expect(await head(bundle.principal, bundle.door)).toBeNull();
  });
});

const gate = (): { readonly waited: Promise<void>; readonly open: () => void } => {
  let open = (): void => {};
  const waited = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { waited, open: () => open() };
};

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe("the per-repository lock", () => {
  it("queues a third act behind a second still holding it", async () => {
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

    /**
     * The first has cleaned up while the second still holds the lock: an entry cleared by
     * anyone but its owner lets this past.
     */
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

const PLATFORM: PlatformPrincipal = { kind: "platform", actorId: "process:better-answers-erasure" };

describe("the commits an empty bundle holds after a watermark", () => {
  it("answers no head and nothing missed without a watermark", async () => {
    const bundle = await arrange();

    const scanned = await commitsAfter(PLATFORM, bundle.door, bundle.workspaceId, null);

    expect(scanned).toEqual({ ok: true, value: { head: null, missed: [] } });
  });

  it("reads a watermark in an empty bundle as diverged", async () => {
    const bundle = await arrange();
    const watermark = "0123456789abcdef0123456789abcdef01234567";

    const scanned = await commitsAfter(PLATFORM, bundle.door, bundle.workspaceId, watermark);

    expect(scanned).toEqual({ ok: false, error: "history-diverged" });
  });
});

describe("a repository whose refs git cannot read", () => {
  const unreadableRefs = async (): Promise<Bundle & { readonly sha: string }> => {
    const bundle = await arrange();
    const sha = shaOf(await commit(bundle.principal, bundle.door, requestFor()));
    await corruptPackedRefs(bundle.door, bundle.workspaceId);
    return { ...bundle, sha };
  };

  it("scans it as a bundle with no head", async () => {
    const bundle = await unreadableRefs();

    expect(await commitsAfter(PLATFORM, bundle.door, bundle.workspaceId, null)).toEqual({
      ok: true,
      value: { head: null, missed: [] },
    });
    expect(await commitsAfter(PLATFORM, bundle.door, bundle.workspaceId, bundle.sha)).toEqual({
      ok: false,
      error: "history-diverged",
    });
  });

  it("refuses a commit expecting its old head as stale", async () => {
    const bundle = await unreadableRefs();

    const refused = await commit(
      bundle.principal,
      bundle.door,
      requestFor({ path: "knowledge/b.md", expectedHead: bundle.sha }),
    );

    expect(refused).toEqual({ ok: false, error: "stale-precondition" });
  });

  it("hands back the store's failure committing on any head", async () => {
    const bundle = await unreadableRefs();

    const failed = await commit(
      bundle.principal,
      bundle.door,
      requestFor({ path: "knowledge/b.md", expectedHead: ANY_HEAD }),
    );

    expect(failed.ok ? undefined : failed.error).toBeInstanceOf(Error);
  });
});

const SUBJECT_EMAIL = "priya@example.invalid";

const bundleNamingPriya = async (): Promise<{ bundle: Bundle; sha: string }> => {
  const bundle = await arrange();
  const written = await commit(
    bundle.principal,
    bundle.door,
    requestFor({
      path: "knowledge/expenses.md",
      content: `---\ngenerated:\n  by: human:${SUBJECT_EMAIL}\n---\n\nExpenses are claimed within thirty days.\n`,
    }),
  );
  return { bundle, sha: shaOf(written) };
};

describe("what a bundle's history names", () => {
  it("answers the commit and path whose file carries the needle", async () => {
    const { bundle, sha } = await bundleNamingPriya();

    const found = await historyNaming(PLATFORM, bundle.door, bundle.workspaceId, [SUBJECT_EMAIL]);

    expect(found).toEqual({
      blobs: [{ commit: sha, path: "knowledge/expenses.md" }],
      authors: [],
    });
  });

  it("answers an author-line match as a commit, not a file", async () => {
    const { bundle, sha } = await bundleNamingPriya();

    const found = await historyNaming(PLATFORM, bundle.door, bundle.workspaceId, [AUTHOR.email]);

    expect(found).toEqual({ blobs: [], authors: [sha] });
  });

  it("answers nothing for an empty history or one naming nobody", async () => {
    const { bundle } = await bundleNamingPriya();
    const empty = await arrange();

    expect(
      await historyNaming(PLATFORM, bundle.door, bundle.workspaceId, ["nobody@example.invalid"]),
    ).toEqual({ blobs: [], authors: [] });
    expect(await historyNaming(PLATFORM, empty.door, empty.workspaceId, [SUBJECT_EMAIL])).toEqual({
      blobs: [],
      authors: [],
    });
  });

  it("hands back an unreadable object's failure, not an empty answer", async () => {
    const { bundle, sha } = await bundleNamingPriya();
    await objectRemovedFrom(bundle.door, bundle.workspaceId, `${sha}:knowledge/expenses.md`);

    await expect(
      historyNaming(PLATFORM, bundle.door, bundle.workspaceId, [SUBJECT_EMAIL]),
    ).rejects.toThrow(/unable to read/);
  });
});

describe("the file this door reads back at a commit", () => {
  it("answers null for a path the commit's tree lacks", async () => {
    const { bundle, sha } = await bundleNamingPriya();

    expect(
      await fileAt(PLATFORM, bundle.door, bundle.workspaceId, sha, "knowledge/travel.md"),
    ).toBe(null);
  });

  it("refuses a missing commit rather than calling the file absent", async () => {
    const { bundle } = await bundleNamingPriya();

    await expect(
      fileAt(PLATFORM, bundle.door, bundle.workspaceId, "0".repeat(40), "knowledge/expenses.md"),
    ).rejects.toThrow(/0{40}/);
  });
});
