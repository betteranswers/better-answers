import { describe, expect, it } from "vitest";

import { bytesOf } from "../../src/trpc/upload.ts";

const streamOf = (chunks: readonly unknown[]): ReadableStream<unknown> =>
  new ReadableStream({
    start: (controller) => {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });

describe("bytesOf, taking an octet body from tRPC", () => {
  it("passes the bytes of the body on, in order", async () => {
    const body = bytesOf(streamOf([new Uint8Array([1, 2]), Buffer.from([3]), new Uint8Array([4])]));

    expect([...new Uint8Array(await new Response(body).arrayBuffer())]).toEqual([1, 2, 3, 4]);
  });

  it("fails the body at a chunk that is not bytes", async () => {
    const body = bytesOf(streamOf([new Uint8Array([1]), "not bytes"]));

    await expect(new Response(body).arrayBuffer()).rejects.toThrow(
      "the request body carried a chunk that is not bytes",
    );
  });
});
