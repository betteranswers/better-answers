import { describe, expect, it } from "vitest";

import type { PlatformPrincipal } from "@better-answers/core/kernel";
import { ulid } from "@better-answers/schema";

import {
  getObject,
  getPlatformObject,
  listObjects,
  listPlatformObjects,
  putObject,
  putPlatformObject,
} from "../../../src/store/objects/index.ts";
import { principalOf } from "../../support/platform.ts";
import { objectStoreForSuite, textOf } from "../../support/suite-objects.ts";
import { answered } from "../../support/suite-postgres.ts";

const store = objectStoreForSuite();

const erasure: PlatformPrincipal = {
  kind: "platform",
  actorId: "process:better-answers-erasure",
};

const newWorkspaceAdmin = () => principalOf(ulid(), ulid(), "Admin");

const streamOf = (text: string): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start: (controller) => {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });

describe("the object door stores a workspace's bytes", () => {
  it("streams back exactly the bytes that were put", async () => {
    const workspace = newWorkspaceAdmin();
    const written = "Grüße, Ada — €5 𝄞";

    const put = await putObject(workspace, store().door, "documents/notice.txt", streamOf(written));
    expect(put).toEqual({ ok: true, value: undefined });

    const got = await getObject(workspace, store().door, "documents/notice.txt");
    expect(await textOf(answered(got))).toEqual("Grüße, Ada — €5 𝄞");
  });

  it("lists only the keys under the requested prefix", async () => {
    const workspace = newWorkspaceAdmin();
    for (const key of ["documents/a.txt", "documents/b.txt", "findings/c.txt", "documents"]) {
      const put = await putObject(workspace, store().door, key, streamOf(key));
      expect(put).toEqual({ ok: true, value: undefined });
    }

    expect(await listObjects(workspace, store().door, "documents/")).toEqual({
      ok: true,
      value: ["documents/a.txt", "documents/b.txt"],
    });
    expect(await listObjects(workspace, store().door, "")).toEqual({
      ok: true,
      value: ["documents", "documents/a.txt", "documents/b.txt", "findings/c.txt"],
    });
  });

  it("keeps each workspace from reading or listing another's keys", async () => {
    const first = newWorkspaceAdmin();
    const second = newWorkspaceAdmin();
    await putObject(first, store().door, "notes.txt", streamOf("the first workspace's notes"));
    await putObject(second, store().door, "notes.txt", streamOf("the second workspace's notes"));

    const firstRead = await getObject(first, store().door, "notes.txt");
    const secondRead = await getObject(second, store().door, "notes.txt");
    expect(await textOf(answered(firstRead))).toEqual("the first workspace's notes");
    expect(await textOf(answered(secondRead))).toEqual("the second workspace's notes");

    await putObject(first, store().door, "only-the-first.txt", streamOf("the first's alone"));
    await putObject(second, store().door, "only-the-second.txt", streamOf("the second's alone"));
    expect(await getObject(second, store().door, "only-the-first.txt")).toEqual({
      ok: false,
      error: "no-such-object",
    });
    expect(await getObject(first, store().door, "only-the-second.txt")).toEqual({
      ok: false,
      error: "no-such-object",
    });
    expect(await listObjects(first, store().door, "")).toEqual({
      ok: true,
      value: ["notes.txt", "only-the-first.txt"],
    });
    expect(await listObjects(second, store().door, "")).toEqual({
      ok: true,
      value: ["notes.txt", "only-the-second.txt"],
    });
  });
});

describe("the object door stores platform bytes apart from workspaces", () => {
  it("stores an erasure copy that no workspace can read", async () => {
    const workspace = newWorkspaceAdmin();
    const key = `erasures/${ulid()}.json`;
    const copy = '{"pseudonym":"erased-person-01","identifiers":["ada@example.invalid"]}';

    const put = await putPlatformObject(erasure, store().door, key, streamOf(copy));
    expect(put).toEqual({ ok: true, value: undefined });

    const got = await getPlatformObject(erasure, store().door, key);
    expect(await textOf(answered(got))).toEqual(
      '{"pseudonym":"erased-person-01","identifiers":["ada@example.invalid"]}',
    );

    expect(await getObject(workspace, store().door, key)).toEqual({
      ok: false,
      error: "no-such-object",
    });
    expect(await listObjects(workspace, store().door, "erasures/")).toEqual({
      ok: true,
      value: [],
    });
    expect(await listPlatformObjects(erasure, store().door, key)).toEqual({
      ok: true,
      value: [key],
    });

    await putObject(workspace, store().door, "erasures/not-the-platform.json", streamOf("{}"));
    const listed = await listPlatformObjects(erasure, store().door, "erasures/");
    const platformKeys = answered(listed);
    expect(platformKeys).toContain(key);
    expect(platformKeys).not.toContain("erasures/not-the-platform.json");
  });

  it("hides from a workspace a platform key under its prefix", async () => {
    const workspace = newWorkspaceAdmin();
    const key = `workspaces/${workspace.workspaceId}/notes.txt`;

    const put = await putPlatformObject(erasure, store().door, key, streamOf("the platform's own"));
    expect(put).toEqual({ ok: true, value: undefined });

    expect(await getObject(workspace, store().door, "notes.txt")).toEqual({
      ok: false,
      error: "no-such-object",
    });
    expect(await listObjects(workspace, store().door, "")).toEqual({ ok: true, value: [] });
  });
});

describe("the object door refuses malformed or escaping keys", () => {
  it.each([
    ["nothing at all", ""],
    ["an absolute path", "/documents/notice.txt"],
    ["a step above the prefix", "../documents/notice.txt"],
    ["an empty segment", "documents//notice.txt"],
    ["a newline", "documents/no\ntice.txt"],
  ])("refuses %s", async (_what, key) => {
    const workspace = newWorkspaceAdmin();
    expect(await putObject(workspace, store().door, key, streamOf("x"))).toEqual({
      ok: false,
      error: "malformed-key",
    });
    expect(await getObject(workspace, store().door, key)).toEqual({
      ok: false,
      error: "malformed-key",
    });
    expect(await putPlatformObject(erasure, store().door, key, streamOf("x"))).toEqual({
      ok: false,
      error: "malformed-key",
    });
  });

  it("lists the whole workspace for an empty prefix", async () => {
    const workspace = newWorkspaceAdmin();
    expect(await listObjects(workspace, store().door, "")).toEqual({ ok: true, value: [] });
    expect(await listObjects(workspace, store().door, "../elsewhere/")).toEqual({
      ok: false,
      error: "malformed-key",
    });
  });
});
