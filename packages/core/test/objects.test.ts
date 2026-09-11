import { ulid } from "@better-answers/schema";
import { describe, expect, it } from "vitest";

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
import { objectStoreForSuite } from "./suite-objects.ts";

/**
 * The object door against a real Garage — the store the estate runs, not a stand-in, for
 * the same reason every data suite runs a real Postgres: what a caller can observe here is
 * an S3 answer, and an in-memory bucket would agree with a door that addressed the wrong
 * bytes.
 *
 * What the suite is about is the door's **prefix discipline**: a caller names a workspace
 * or the platform and a key within it, never a bucket key, so the cases below are written
 * from the outside — put, get, list — and each one that matters is checked in both
 * directions (one workspace's key is unreachable from another's, and the other's from the
 * first).
 */

const store = objectStoreForSuite();

/** The erasure routine's own identity — the platform principal step 10 writes under. */
const erasure: PlatformPrincipal = {
  kind: "platform",
  actorId: "process:better-answers-erasure",
};

/** One workspace's Admin, on a workspace id nothing else in this file uses. */
const someone = () => principalOf(ulid(), ulid(), "Admin");

/** The body a put takes: a stream, because a document's bytes arrive as one. */
const streamOf = (text: string): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start: (controller) => {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });

/** What a get answered, as text — the assertion's side of `streamOf`. */
const textOf = async (stream: ReadableStream<Uint8Array>): Promise<string> => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
};

describe("the object door keeps a workspace's bytes", () => {
  it("gives back exactly the bytes that were put, over a stream", async () => {
    const workspace = someone();
    const written = "Grüße, Ada — €5 𝄞";

    const put = await putObject(workspace, store().door, "documents/notice.txt", streamOf(written));
    expect(put).toEqual({ ok: true, value: undefined });

    const got = await getObject(workspace, store().door, "documents/notice.txt");
    if (!got.ok) throw new Error(`the door refused the read: ${got.error}`);
    expect(await textOf(got.value)).toEqual("Grüße, Ada — €5 𝄞");
  });

  it("answers a list with the keys under the prefix asked for and no key outside it", async () => {
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

  it("keeps one workspace's key out of another's reach, and the other's out of the first's", async () => {
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

describe("the object door keeps the platform's own bytes apart from every workspace's", () => {
  it("puts a replay copy where no workspace can address it, and lists it there alone", async () => {
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

describe("the object door refuses a key that names nothing inside a prefix", () => {
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

  it("takes an empty listing prefix, which names everything under the workspace prefix", async () => {
    const workspace = someone();
    expect(await listObjects(workspace, store().door, "")).toEqual({ ok: true, value: [] });
    expect(await listObjects(workspace, store().door, "../elsewhere/")).toEqual({
      ok: false,
      error: "malformed-key",
    });
  });
});
