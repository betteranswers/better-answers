import { describe, expect, it } from "vitest";

import { boundarySchemas, ulid } from "@better-answers/schema";

import type { PlatformPrincipal, UserPrincipal } from "../../../src/kernel/index.ts";
import {
  bundleSnapshot,
  initRepository,
  rewriteHistory,
  type GitDoor,
} from "../../../src/store/git/index.ts";
import { bundlesForSuite, treeCommitted } from "../../fixtures/bundle.ts";
import { gitStarts, whileGitPausesAt } from "./git-starts.ts";

const bundles = bundlesForSuite();

const MANIFEST = "knowledge/manifest.yaml";

const OPEN = "knowledge/policies/expenses.md";

const WITHHELD = "knowledge/policies/salaries.md";

const SKELETON = "guides/01K4GUIDE0000000000000000.yaml";

const NOT_UTF8 = Uint8Array.of(0xff, 0xfe, 0x00, 0x80, 0x0a, 0xc3);

type Bundle = {
  readonly door: GitDoor;
  readonly principal: UserPrincipal;
  readonly head: string;
};

const bundleHolding = async (files: ReadonlyMap<string, string | Uint8Array>): Promise<Bundle> => {
  const workspaceId = ulid();
  const door = bundles();
  await initRepository(door, workspaceId);
  const head = await treeCommitted(door, workspaceId, files, "Land");
  const principal: UserPrincipal = {
    kind: "user",
    workspaceId: boundarySchemas.workspace.select.shape.id.parse(workspaceId),
    userId: boundarySchemas.user.select.shape.id.parse(ulid()),
    role: "Admin",
    groups: [],
    credentialIssuedAtMs: Date.now(),
    secondFactorConfirmedAtMs: Date.now(),
  };
  return { door, principal, head };
};

type Snapshot = Awaited<ReturnType<typeof bundleSnapshot>>;

const filesOf = (snapshot: Snapshot | undefined) => {
  if (snapshot?.ok !== true) throw new Error("no snapshot was taken");
  return snapshot.value.map(({ path, bytes }) => [path, Buffer.from(bytes)]);
};

const file = (path: string, content: string | Uint8Array) => [path, Buffer.from(content)];

describe("a snapshot of the bundle", () => {
  it("includes the manifest and readable files but no guides/ file", async () => {
    const { door, principal, head } = await bundleHolding(
      new Map([
        [MANIFEST, "owner: Acme\n"],
        [OPEN, "Claim within thirty days.\n"],
        [WITHHELD, "Pay bands.\n"],
        [SKELETON, "sections: []\n"],
      ]),
    );

    const snapshot = await bundleSnapshot(principal, door, head, new Set([OPEN, SKELETON]));

    expect(filesOf(snapshot)).toEqual([
      file(MANIFEST, "owner: Acme\n"),
      file(OPEN, "Claim within thirty days.\n"),
    ]);
  });

  it("copies any file's bytes unchanged", async () => {
    const { door, principal, head } = await bundleHolding(new Map([[OPEN, NOT_UTF8]]));

    const snapshot = await bundleSnapshot(principal, door, head, new Set([OPEN]));

    expect(filesOf(snapshot)).toEqual([file(OPEN, NOT_UTF8)]);
  });

  it("reads no blob when no readable file is kept", async () => {
    const { door, principal, head } = await bundleHolding(
      new Map([
        [WITHHELD, "Pay bands.\n"],
        [SKELETON, "sections: []\n"],
      ]),
    );
    let snapshot: Snapshot | undefined;

    const started = await gitStarts(async () => {
      snapshot = await bundleSnapshot(principal, door, head, new Set([OPEN, SKELETON]));
    });

    expect(snapshot).toEqual({ ok: true, value: [] });
    expect(started).toEqual(["ls-tree"]);
  });

  it("reads the commit it is given, not the head", async () => {
    const { door, principal, head } = await bundleHolding(new Map([[OPEN, "Thirty days.\n"]]));
    await treeCommitted(door, principal.workspaceId, new Map([[OPEN, "A week.\n"]]), "Later");

    const snapshot = await bundleSnapshot(principal, door, head, new Set([OPEN]));

    expect(filesOf(snapshot)).toEqual([file(OPEN, "Thirty days.\n")]);
  });

  it("refuses a snapshot over its byte cap before reading files", async () => {
    const files = new Map([
      [MANIFEST, "owner: Acme\n"],
      [OPEN, "Claim within thirty days.\n"],
    ]);
    const { door, principal, head } = await bundleHolding(files);
    const held = [...files.values()].join("").length;
    let refused: Snapshot | undefined;

    const started = await gitStarts(async () => {
      refused = await bundleSnapshot(
        principal,
        { ...door, snapshotBytesMax: held - 1 },
        head,
        new Set([OPEN]),
      );
    });

    expect(refused).toEqual({ ok: false, error: "export-too-large" });
    expect(started).not.toContain("cat-file");
    expect(
      filesOf(
        await bundleSnapshot(principal, { ...door, snapshotBytesMax: held }, head, new Set([OPEN])),
      ),
    ).toHaveLength(2);
  });

  it("reads 3,000 files with two git processes", async () => {
    const paths = Array.from({ length: 3_000 }, (_unused, at) => `knowledge/wide/node-${at}.md`);
    const { door, principal, head } = await bundleHolding(
      new Map(paths.map((path, at) => [path, `Rule ${String(at)}.\n`])),
    );
    let snapshot: Snapshot | undefined;

    const started = await gitStarts(async () => {
      snapshot = await bundleSnapshot(principal, door, head, new Set(paths));
    });

    expect(started).toEqual(["ls-tree", "cat-file"]);
    expect(filesOf(snapshot)).toHaveLength(3_000);
    expect(filesOf(snapshot)).toContainEqual(file("knowledge/wide/node-2999.md", "Rule 2999.\n"));
  });
});

const ERASURE: PlatformPrincipal = { kind: "platform", actorId: "process:better-answers-erasure" };

const LEAVER = "leaver@example.com";

describe("a snapshot while an erasure rewrites the history", () => {
  for (const subcommand of ["ls-tree", "cat-file"]) {
    it(`refuses when the erasure prunes the commit before ${subcommand}`, async () => {
      const { door, principal, head } = await bundleHolding(
        new Map([
          [MANIFEST, "owner: Acme\n"],
          [OPEN, `Ask human:${LEAVER} about a claim.\n`],
        ]),
      );

      const snapshot = await whileGitPausesAt(
        { subcommand, after: false },
        () => bundleSnapshot(principal, door, head, new Set([OPEN])),
        async () => {
          await rewriteHistory(ERASURE, door, principal.workspaceId, {
            addresses: [LEAVER],
            people: [],
            pseudonym: ulid(),
          });
        },
      );

      expect(snapshot).toEqual({ ok: false, error: "commit-gone" });
    });
  }
});
