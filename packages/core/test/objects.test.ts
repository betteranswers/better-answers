import { describe, expect, it } from "vitest";

import { ulid } from "@better-answers/schema";

import type { PlatformPrincipal } from "../src/kernel/index.ts";
import {
  getObject,
  getPlatformObject,
  listObjects,
  listPlatformObjects,
  putObject,
  putPlatformObject,
} from "../src/store/objects/index.ts";
import { principalOf } from "./platform.ts";
import { objectStoreForSuite, textOf } from "./suite-objects.ts";

const store = objectStoreForSuite();

const erasure: PlatformPrincipal = {
  kind: "platform",
  actorId: "process:better-answers-erasure",
};

const someone = () => principalOf(ulid(), ulid(), "Admin");

const streamOf = (text: string): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start: (controller) => {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });

describe("the object door keeps a workspace's bytes", () => {
  it("gives back exactly the bytes put, over a stream", async () => {
    const workspace = someone();
    const written = "Grüße, Ada — €5 𝄞";

    const put = await putObject(workspace, store().door, "documents/notice.txt", streamOf(written));
    expect(put).toEqual({ ok: true, value: undefined });

    const got = await getObject(workspace, store().door, "documents/notice.txt");
    if (!got.ok) throw new Error(`the door refused the read: ${got.error}`);
    expect(await textOf(got.value)).toEqual("Grüße, Ada — €5 𝄞");
  });

  it("lists only the keys under the prefix asked for", async () => {
    const workspace = someone();
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

  it("keeps each workspace's keys out of the other's reach", async () => {
    const first = someone();
    const second = someone();
    await putObject(first, store().door, "notes.txt", streamOf("the first workspace's notes"));
    await putObject(second, store().door, "notes.txt", streamOf("the second workspace's notes"));

    const firstRead = await getObject(first, store().door, "notes.txt");
    const secondRead = await getObject(second, store().door, "notes.txt");
    if (!firstRead.ok || !secondRead.ok) throw new Error("the door refused a read it should not");
    expect(await textOf(firstRead.value)).toEqual("the first workspace's notes");
    expect(await textOf(secondRead.value)).toEqual("the second workspace's notes");

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

describe("the object door keeps platform bytes apart from every workspace's", () => {
  it("puts a replay copy beyond workspaces, and lists it alone", async () => {
    const workspace = someone();
    const key = `erasures/${ulid()}.json`;
    const copy = '{"pseudonym":"erased-person-01","identifiers":["ada@example.invalid"]}';

    const put = await putPlatformObject(erasure, store().door, key, streamOf(copy));
    expect(put).toEqual({ ok: true, value: undefined });

    const got = await getPlatformObject(erasure, store().door, key);
    if (!got.ok) throw new Error(`the door refused the read: ${got.error}`);
    expect(await textOf(got.value)).toEqual(
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
    if (!listed.ok) throw new Error(`the door refused the listing: ${listed.error}`);
    expect(listed.value).toContain(key);
    expect(listed.value).not.toContain("erasures/not-the-platform.json");
  });
});

describe("the object door refuses keys naming nothing inside a prefix", () => {
  it.each([
    ["nothing at all", ""],
    ["an absolute path", "/documents/notice.txt"],
    ["a step above the prefix", "../documents/notice.txt"],
    ["an empty segment", "documents//notice.txt"],
    ["a newline", "documents/no\ntice.txt"],
  ])("refuses %s", async (_what, key) => {
    const workspace = someone();
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

  it("takes an empty listing prefix as everything under the workspace", async () => {
    const workspace = someone();
    expect(await listObjects(workspace, store().door, "")).toEqual({ ok: true, value: [] });
    expect(await listObjects(workspace, store().door, "../elsewhere/")).toEqual({
      ok: false,
      error: "malformed-key",
    });
  });
});
