import { describe, expect, it } from "vitest";

import { boundarySchemas, ulid } from "@better-answers/schema";

import type { UserPrincipal } from "../../../src/kernel/index.ts";
import { bundleSnapshot, initRepository, type GitDoor } from "../../../src/store/git/index.ts";
import { bundlesForSuite, treeCommitted } from "../../fixtures/bundle.ts";
import { gitStarts } from "./git-starts.ts";

const bundles = bundlesForSuite();

const MANIFEST = "knowledge/manifest.yaml";

const OPEN = "knowledge/policies/expenses.md";

const WITHHELD = "knowledge/policies/salaries.md";

const SKELETON = "guides/01K4GUIDE0000000000000000.yaml";

const NOT_UTF8 = Uint8Array.of(0xff, 0xfe, 0x00, 0x80, 0x0a, 0xc3);

type Bundle = {
  readonly door: GitDoor;
  readonly principal: UserPrincipal;
  readonly head: string | null;
};

const bundleHolding = async (files: ReadonlyMap<string, string | Uint8Array>): Promise<Bundle> => {
  const workspaceId = ulid();
  const door = bundles();
  await initRepository(door, workspaceId);
  const head = files.size === 0 ? null : await treeCommitted(door, workspaceId, files, "Land");
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
  if (snapshot?.ok !== true || snapshot.value === null) throw new Error("no snapshot was taken");
  return snapshot.value.files.map(({ path, bytes }) => [path, Buffer.from(bytes)]);
};

const file = (path: string, content: string | Uint8Array) => [path, Buffer.from(content)];

describe("a snapshot of the bundle", () => {
  it("keeps the manifest and readable files, never a guides/ file", async () => {
    const { door, principal, head } = await bundleHolding(
      new Map([
        [MANIFEST, "owner: Acme\n"],
        [OPEN, "Claim within thirty days.\n"],
        [WITHHELD, "Pay bands.\n"],
        [SKELETON, "sections: []\n"],
      ]),
    );

    const snapshot = await bundleSnapshot(principal, door, new Set([OPEN, SKELETON]));

    expect(snapshot).toMatchObject({ ok: true, value: { head } });
    expect(filesOf(snapshot)).toEqual([
      file(MANIFEST, "owner: Acme\n"),
      file(OPEN, "Claim within thirty days.\n"),
    ]);
  });

  it("carries a file's bytes unchanged, whatever they are", async () => {
    const { door, principal } = await bundleHolding(new Map([[OPEN, NOT_UTF8]]));

    const snapshot = await bundleSnapshot(principal, door, new Set([OPEN]));

    expect(filesOf(snapshot)).toEqual([file(OPEN, NOT_UTF8)]);
  });

  it("starts no blob read when it keeps no file", async () => {
    const { door, principal, head } = await bundleHolding(
      new Map([
        [WITHHELD, "Pay bands.\n"],
        [SKELETON, "sections: []\n"],
      ]),
    );
    let snapshot: Snapshot | undefined;

    const started = await gitStarts(async () => {
      snapshot = await bundleSnapshot(principal, door, new Set([OPEN, SKELETON]));
    });

    expect(snapshot).toEqual({ ok: true, value: { head, files: [] } });
    expect(started).toEqual(["rev-parse", "ls-tree"]);
  });

  it("answers null for a bundle with no commit", async () => {
    const { door, principal } = await bundleHolding(new Map());

    expect(await bundleSnapshot(principal, door, new Set([OPEN]))).toEqual({
      ok: true,
      value: null,
    });
  });

  it("refuses past its byte cap before reading a file", async () => {
    const files = new Map([
      [MANIFEST, "owner: Acme\n"],
      [OPEN, "Claim within thirty days.\n"],
    ]);
    const { door, principal } = await bundleHolding(files);
    const held = [...files.values()].join("").length;
    let refused: Snapshot | undefined;

    const started = await gitStarts(async () => {
      refused = await bundleSnapshot(
        principal,
        { ...door, snapshotBytesMax: held - 1 },
        new Set([OPEN]),
      );
    });

    expect(refused).toEqual({ ok: false, error: "export-too-large" });
    expect(started).not.toContain("cat-file");
    expect(
      filesOf(
        await bundleSnapshot(principal, { ...door, snapshotBytesMax: held }, new Set([OPEN])),
      ),
    ).toHaveLength(2);
  });

  it("reads 3,000 files with three git processes", async () => {
    const paths = Array.from({ length: 3_000 }, (_unused, at) => `knowledge/wide/node-${at}.md`);
    const { door, principal } = await bundleHolding(
      new Map(paths.map((path, at) => [path, `Rule ${String(at)}.\n`])),
    );
    let snapshot: Snapshot | undefined;

    const started = await gitStarts(async () => {
      snapshot = await bundleSnapshot(principal, door, new Set(paths));
    });

    expect(started).toEqual(["rev-parse", "ls-tree", "cat-file"]);
    expect(filesOf(snapshot)).toHaveLength(3_000);
    expect(filesOf(snapshot)).toContainEqual(file("knowledge/wide/node-2999.md", "Rule 2999.\n"));
  });
});
