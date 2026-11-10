import { appendFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { ActorId, PlatformPrincipal, UserPrincipal } from "@better-answers/core/kernel";
import {
  ANY_HEAD,
  commit,
  commitsAfter,
  fileAt,
  fileAtHead,
  head,
  historyNaming,
  initRepository,
  openGit,
  rewriteHistory,
  withRepositoryLock,
  type CommitRequest,
  type GitDoor,
} from "@better-answers/core/store/git";
import { boundarySchemas, ulid } from "@better-answers/schema";
import { matching } from "@better-answers/schema/testing/matching";

import {
  bundleHistory,
  bundlesForSuite,
  commitFacts,
  corruptPackedRefs,
  fileAtCommit,
  objectRemovedFrom,
  staged,
} from "../../fixtures/bundle.ts";
import { gitStarts, whileGitHangsAt } from "./git-starts.ts";

const bundles = bundlesForSuite();

const memberOf = (workspaceId: string): UserPrincipal => ({
  kind: "user",

  workspaceId: boundarySchemas.workspace.select.shape.id.parse(workspaceId),
  userId: boundarySchemas.user.select.shape.id.parse(ulid()),
  role: "Editor",
  groups: [],
  credentialIssuedAtMs: Date.now(),
  secondFactorConfirmedAtMs: Date.now(),
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
  parentRecorded: () => Promise.resolve(true),
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

describe("the file paths the git door accepts", () => {
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

  it("writes a relative path at any depth inside the bundle", async () => {
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

describe("the index a commit builds", () => {
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

  it("runs rev-parse once, then the plumbing commands, on a parent", async () => {
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

  it("commits on the current head when it expects any head", async () => {
    const bundle = await arrange();
    const first = shaOf(await commit(bundle.principal, bundle.door, requestFor()));

    const second = await commit(
      bundle.principal,
      bundle.door,
      requestFor({ path: "knowledge/b.md", expectedHead: ANY_HEAD }),
    );

    expect(second).toEqual({ ok: true, value: { sha: matching.any(String), parent: first } });
    expect(await bundleHistory(bundle.door, bundle.workspaceId)).toEqual([first, shaOf(second)]);
  });

  it("makes the first commit when it expects any head", async () => {
    const bundle = await arrange();

    const first = await commit(
      bundle.principal,
      bundle.door,
      requestFor({ expectedHead: ANY_HEAD }),
    );

    expect(first).toEqual({ ok: true, value: { sha: matching.any(String), parent: null } });
    expect(await head(bundle.principal, bundle.door)).toBe(shaOf(first));
  });

  it("refuses a parent the database has not recorded, committing nothing", async () => {
    const bundle = await arrange();
    const first = shaOf(await commit(bundle.principal, bundle.door, requestFor()));
    const asked: string[] = [];

    const refused = await commit(
      bundle.principal,
      bundle.door,
      requestFor({
        path: "knowledge/b.md",
        expectedHead: ANY_HEAD,
        parentRecorded: (parent) => {
          asked.push(parent);
          return Promise.resolve(false);
        },
      }),
    );

    expect(refused).toEqual({ ok: false, error: "unrecorded-head" });
    expect(asked).toEqual([first]);
    expect(await bundleHistory(bundle.door, bundle.workspaceId)).toEqual([first]);
  });

  it("leaves the repository's own index empty after a commit", async () => {
    const bundle = await arrange();

    await commit(bundle.principal, bundle.door, requestFor());

    expect(await staged(bundle.door, bundle.workspaceId)).toEqual([]);
  });

  it("leaves no staging directory in the temporary directory", async () => {
    const bundle = await arrange();
    const temporary = await mkdtemp(path.join(tmpdir(), "git-staging-"));
    vi.stubEnv("TMPDIR", temporary);
    try {
      const committed = await commit(bundle.principal, bundle.door, requestFor());

      expect(committed.ok).toBe(true);
      expect(await readdir(temporary)).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
      await rm(temporary, { recursive: true, force: true });
    }
  });
});

const namesGitSeesAtRefUpdate = async (bundle: Bundle): Promise<string> => {
  const gitDir = path.join(bundle.door.root, `${bundle.workspaceId}.git`);
  const hooks = path.join(gitDir, "hooks");
  const seen = path.join(gitDir, "seen-environment");
  await mkdir(hooks, { recursive: true });
  await writeFile(path.join(hooks, "reference-transaction"), `#!/bin/sh\nenv > '${seen}'\n`, {
    mode: 0o755,
  });
  await appendFile(path.join(gitDir, "config"), `[core]\n\thooksPath = ${hooks}\n`);
  return seen;
};

describe("a commit made while the platform holds its secrets", () => {
  it("shows git's processes none of the platform's secrets", async () => {
    vi.stubEnv("KEK", "0".repeat(64));
    vi.stubEnv("AUTH_SECRET", "a".repeat(32));
    try {
      const bundle = await arrange();
      const seen = await namesGitSeesAtRefUpdate(bundle);

      const committed = await commit(bundle.principal, bundle.door, requestFor());

      expect(await head(bundle.principal, bundle.door)).toBe(shaOf(committed));
      const names = (await readFile(seen, "utf8"))
        .split("\n")
        .map((line) => line.slice(0, line.indexOf("=")));
      expect(names).toContain("PATH");
      expect(names).not.toContain("KEK");
      expect(names).not.toContain("AUTH_SECRET");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("a git failure after the precondition check passes", () => {
  it("refuses as stale when the ref's lock file already exists", async () => {
    const bundle = await arrange();

    await writeFile(
      path.join(bundle.door.root, `${bundle.workspaceId}.git`, "refs/heads/main.lock"),
      "",
    );

    const refused = await commit(bundle.principal, bundle.door, requestFor());

    expect(refused).toEqual({ ok: false, error: "stale-precondition" });
  });

  it("returns git's error for any other refused write", async () => {
    const bundle = await arrange();

    const failed = await commit(bundle.principal, bundle.door, requestFor({ path: ".git/config" }));

    expect(failed).toEqual({ ok: false, error: matching.any(Error) });
    expect(await head(bundle.principal, bundle.door)).toBeNull();
  });
});

const BUDGET_MS = 300;

const overBudget = {
  ok: false,
  error: matching.objectContaining({
    message: matching.stringContaining(`took longer than ${BUDGET_MS} ms`),
  }),
};

const budgetEndingOn = (bundle: Bundle, budgetEnds: () => AbortSignal): GitDoor => ({
  ...bundle.door,
  commitBudgetMs: BUDGET_MS,
  commitTimeout: budgetEnds,
});

const stillRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("a commit that runs past its time budget", () => {
  it("reports the overrun, not a missing repository, when rev-parse hangs", async () => {
    const bundle = await arrange();
    let answered: unknown;

    await whileGitHangsAt("rev-parse", async (budgetEnds) => {
      answered = await commit(bundle.principal, budgetEndingOn(bundle, budgetEnds), requestFor());
    });

    expect(answered).toMatchObject(overBudget);
  });

  it("reports the overrun when hash-object hangs on a large input", async () => {
    const bundle = await arrange();
    const large = requestFor({ content: "x".repeat(4 * 1024 * 1024) });
    let answered: unknown;

    await whileGitHangsAt("hash-object", async (budgetEnds) => {
      answered = await commit(bundle.principal, budgetEndingOn(bundle, budgetEnds), large);
    });

    expect(answered).toMatchObject(overBudget);
  });

  it("returns only after the stopped git process has exited", async () => {
    const bundle = await arrange();

    const hung = await whileGitHangsAt("rev-parse", async (budgetEnds) => {
      await commit(bundle.principal, budgetEndingOn(bundle, budgetEnds), requestFor());
    });

    expect(stillRunning(hung)).toBe(false);
  });
});

describe("the commit message the git door writes", () => {
  it("includes all five trailers when the action supplies all five", async () => {
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
  it("queues a third action while the second holds the lock", async () => {
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

describe("listing commits after a watermark in an empty bundle", () => {
  it("returns no head and no missed commits without a watermark", async () => {
    const bundle = await arrange();

    const scanned = await commitsAfter(PLATFORM, bundle.door, bundle.workspaceId, null);

    expect(scanned).toEqual({ ok: true, value: { head: null, missed: [] } });
  });

  it("reports diverged history for a watermark in an empty bundle", async () => {
    const bundle = await arrange();
    const watermark = "0123456789abcdef0123456789abcdef01234567";

    const scanned = await commitsAfter(PLATFORM, bundle.door, bundle.workspaceId, watermark);

    expect(scanned).toEqual({ ok: false, error: "history-diverged" });
  });
});

describe("a bundle with an unreadable commit behind its head", () => {
  it("returns the scan's error instead of throwing it", async () => {
    const bundle = await arrange();
    const first = shaOf(await commit(bundle.principal, bundle.door, requestFor()));
    shaOf(
      await commit(
        bundle.principal,
        bundle.door,
        requestFor({ path: "knowledge/b.md", expectedHead: first }),
      ),
    );
    await objectRemovedFrom(bundle.door, bundle.workspaceId, first);

    const scanned = await commitsAfter(PLATFORM, bundle.door, bundle.workspaceId, null);

    expect(scanned).toEqual({ ok: false, error: matching.any(Error) });
  });
});

describe("a repository whose refs git cannot read", () => {
  const unreadableRefs = async (): Promise<Bundle & { readonly sha: string }> => {
    const bundle = await arrange();
    const sha = shaOf(await commit(bundle.principal, bundle.door, requestFor()));
    await corruptPackedRefs(bundle.door, bundle.workspaceId);
    return { ...bundle, sha };
  };

  it("scans the repository as a bundle with no head", async () => {
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

  it("refuses as stale a commit that expects the old head", async () => {
    const bundle = await unreadableRefs();

    const refused = await commit(
      bundle.principal,
      bundle.door,
      requestFor({ path: "knowledge/b.md", expectedHead: bundle.sha }),
    );

    expect(refused).toEqual({ ok: false, error: "stale-precondition" });
  });

  it("returns git's error for a commit that expects any head", async () => {
    const bundle = await unreadableRefs();

    const failed = await commit(
      bundle.principal,
      bundle.door,
      requestFor({ path: "knowledge/b.md", expectedHead: ANY_HEAD }),
    );

    expect(failed).toEqual({ ok: false, error: matching.any(Error) });
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

describe("searching a bundle's history for an address", () => {
  it("returns each commit and path whose file holds the address", async () => {
    const { bundle, sha } = await bundleNamingPriya();

    const found = await historyNaming(PLATFORM, bundle.door, bundle.workspaceId, [SUBJECT_EMAIL]);

    expect(found).toEqual({
      blobs: [{ commit: sha, path: "knowledge/expenses.md" }],
      authors: [],
    });
  });

  it("returns an author-line match as a commit, not a file", async () => {
    const { bundle, sha } = await bundleNamingPriya();

    const found = await historyNaming(PLATFORM, bundle.door, bundle.workspaceId, [AUTHOR.email]);

    expect(found).toEqual({ blobs: [], authors: [sha] });
  });

  it("returns nothing for an empty history or one without matches", async () => {
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

  it("throws on an unreadable object instead of returning nothing", async () => {
    const { bundle, sha } = await bundleNamingPriya();
    await objectRemovedFrom(bundle.door, bundle.workspaceId, `${sha}:knowledge/expenses.md`);

    await expect(
      historyNaming(PLATFORM, bundle.door, bundle.workspaceId, [SUBJECT_EMAIL]),
    ).rejects.toThrow(/unable to read/);
  });
});

describe("rewriting the history to erase an address", () => {
  it("leaves a longer address that begins with the erased one", async () => {
    const bundle = await arrange();
    await commit(
      bundle.principal,
      bundle.door,
      requestFor({
        content: "Ask human:a@b.com, human:a@b.co.uk or human:A@B.CO.\n",
      }),
    );
    const pseudonym = ulid();

    await rewriteHistory(PLATFORM, bundle.door, bundle.workspaceId, {
      addresses: ["a@b.co"],
      people: [],
      pseudonym,
    });

    expect(await fileAtHead(bundle.principal, bundle.door, "knowledge/expenses.md")).toBe(
      `Ask human:a@b.com, human:a@b.co.uk or human:${pseudonym}.\n`,
    );
  });
});

describe("reading a file at a commit", () => {
  it("returns null for a path missing from the commit's tree", async () => {
    const { bundle, sha } = await bundleNamingPriya();

    expect(
      await fileAt(PLATFORM, bundle.door, bundle.workspaceId, sha, "knowledge/travel.md"),
    ).toBe(null);
  });

  it("throws for a missing commit instead of returning null", async () => {
    const { bundle } = await bundleNamingPriya();

    await expect(
      fileAt(PLATFORM, bundle.door, bundle.workspaceId, "0".repeat(40), "knowledge/expenses.md"),
    ).rejects.toThrow(/0{40}/);
  });
});
