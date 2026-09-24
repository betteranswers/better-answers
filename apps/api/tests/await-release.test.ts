import { spawn } from "node:child_process";
import { createServer } from "node:http";
import path from "node:path";

import { serve } from "@hono/node-server";
import type { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { serverFor, startApp, type TestApp } from "./harness.ts";

const script = path.resolve(import.meta.dirname, "../../../deploy/await-release.sh");

const PROMOTED = "sha256:1f2e3d4c5b6a79880a9b8c7d6e5f40312a3b4c5d6e7f8091a2b3c4d5e6f70819";
const REPLACED = "sha256:e0d1c2b3a4958677f6e5d4c3b2a19080f7e6d5c4b3a29181a0b1c2d3e4f50617";

type Run = { readonly code: number | null; readonly output: string };

const run = (args: readonly string[], polls = 1): Promise<Run> =>
  new Promise((resolve, reject) => {
    const child = spawn("bash", [script, ...args], {
      env: { ...process.env, AWAIT_RELEASE_POLLS: String(polls), AWAIT_RELEASE_DELAY_SECONDS: "0" },
    });
    let output = "";
    const collect = (chunk: Buffer): void => {
      output += chunk.toString("utf8");
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
  });

describe("the release's wait against the api's own /health", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await startApp();
    // Two authorization servers initialising at once on one database race for one row, so the harness's own settles first.
    await app.server.request("/health");
  });

  afterAll(async () => {
    await app.stop();
  });

  const serving = async (server: Hono, work: (origin: string) => Promise<void>) => {
    let listener: ReturnType<typeof serve> | undefined;
    const port = await new Promise<number>((resolve) => {
      listener = serve({ fetch: server.fetch, port: 0, hostname: "127.0.0.1" }, (info) =>
        resolve(info.port),
      );
    });
    try {
      await work(`http://127.0.0.1:${String(port)}`);
    } finally {
      await new Promise((resolve) => listener?.close(resolve));
    }
  };

  it("passes when the api names the promoted image, and fails when it names another", async () => {
    await serving(serverFor(app.database.pool, { imageDigest: REPLACED }), async (origin) => {
      expect((await run([origin, REPLACED])).code).toBe(0);

      const other = await run([origin, PROMOTED]);
      expect(other.code).toBe(1);
      expect(other.output).toContain(
        `expected ${PROMOTED}, answering ${REPLACED} (the last answer: healthy)`,
      );
    });
  });

  it("fails against an api started without an image, which names none", async () => {
    await serving(app.server, async (origin) => {
      const waited = await run([origin, PROMOTED]);

      expect(waited.code).toBe(1);
      expect(waited.output).toContain("answering no image named (the last answer: healthy)");
    });
  });
});

type Answer = { readonly status: number; readonly body: string };

const healthy = (image: string): Answer => ({
  status: 200,
  body: JSON.stringify({ status: "healthy", database: "reachable", identity: "ready", image }),
});

const unhealthy = (image: string): Answer => ({
  status: 503,
  body: JSON.stringify({ status: "unhealthy", database: "unreachable", identity: "ready", image }),
});

const BEFORE_HEALTH_NAMED_ITS_IMAGE: Answer = {
  status: 200,
  body: JSON.stringify({ status: "healthy", database: "reachable", identity: "ready" }),
};

const EDGE_WHILE_NO_CONTAINER_ANSWERS: Answer = {
  status: 502,
  body: "<html><body>Bad gateway</body></html>",
};

type Waited = Run & { readonly asked: number };

const awaitReleaseThrough = async (
  answersInTurn: readonly Answer[],
  digest: string | undefined,
  polls: number,
): Promise<Waited> => {
  let asked = 0;
  const production = createServer((_request, response) => {
    const answer = answersInTurn[Math.min(asked, answersInTurn.length - 1)];
    asked += 1;
    response.writeHead(answer?.status ?? 500, { "content-type": "application/json" });
    response.end(answer?.body ?? "");
  });
  await new Promise<void>((resolve) => production.listen(0, "127.0.0.1", resolve));
  try {
    const address = production.address();
    if (address === null || typeof address === "string") throw new Error("no port to listen on");
    const origin = `http://127.0.0.1:${String(address.port)}`;
    const waited = await run(digest === undefined ? [origin] : [origin, digest], polls);
    return { ...waited, asked };
  } finally {
    await new Promise((resolve) => production.close(resolve));
  }
};

describe("the release's wait through a deploy's sequence of answers", () => {
  it("passes once production answers healthy on the promoted image", async () => {
    const waited = await awaitReleaseThrough([healthy(PROMOTED)], PROMOTED, 3);

    expect(waited).toMatchObject({ code: 0, asked: 1 });
  });

  it("fails while the build it replaced still answers healthy, naming the digest expected and the one answering", async () => {
    const waited = await awaitReleaseThrough([healthy(REPLACED)], PROMOTED, 3);

    expect(waited).toMatchObject({ code: 1, asked: 3 });
    expect(waited.output).toContain(
      `expected ${PROMOTED}, answering ${REPLACED} (the last answer: healthy)`,
    );
  });

  it("keeps waiting through the old build, the edge's error and an unhealthy start, until the promoted image answers healthy", async () => {
    const swap = [
      BEFORE_HEALTH_NAMED_ITS_IMAGE,
      EDGE_WHILE_NO_CONTAINER_ANSWERS,
      unhealthy(PROMOTED),
      healthy(PROMOTED),
    ];

    expect(await awaitReleaseThrough(swap, PROMOTED, 6)).toMatchObject({ code: 0, asked: 4 });
  });

  it("never passes on an unhealthy answer, even one naming the promoted image", async () => {
    const waited = await awaitReleaseThrough([unhealthy(PROMOTED)], PROMOTED, 3);

    expect(waited).toMatchObject({ code: 1, asked: 3 });
    expect(waited.output).toContain(`answering ${PROMOTED} (the last answer: unhealthy)`);
  });

  it("names nothing as answering once production stops answering, and names the image last seen before it", async () => {
    const waited = await awaitReleaseThrough(
      [healthy(REPLACED), EDGE_WHILE_NO_CONTAINER_ANSWERS],
      PROMOTED,
      3,
    );

    expect(waited).toMatchObject({ code: 1, asked: 3 });
    expect(waited.output).toContain(
      `answering no image named (the last answer: no health answer; the last image named was ${REPLACED})`,
    );
  });

  it("fails a rollback to an api that names no image, saying the healthy answer at the end named none", async () => {
    const rollback = [healthy(PROMOTED), BEFORE_HEALTH_NAMED_ITS_IMAGE];
    const waited = await awaitReleaseThrough(rollback, REPLACED, 3);

    expect(waited).toMatchObject({ code: 1, asked: 3 });
    expect(waited.output).toContain(
      `answering no image named (the last answer: healthy; the last image named was ${PROMOTED})`,
    );
  });

  it.each([
    ["something that is not a digest", PROMOTED.slice(0, 19)],
    ["no digest at all", undefined],
  ])("refuses to wait for %s, before asking production anything", async (_case, digest) => {
    const waited = await awaitReleaseThrough([healthy(PROMOTED)], digest, 3);

    expect(waited).toMatchObject({ code: 2, asked: 0 });
  });
});
