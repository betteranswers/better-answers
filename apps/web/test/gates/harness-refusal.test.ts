import { createServer } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { request, type APIRequestContext } from "@playwright/test";
import { assert, describe, expect, it } from "vitest";
import { z } from "zod";

import { workspaceRoot } from "@test/roots.ts";

const aHarness = z.object({
  seedConnectedSources: z.custom<
    (
      api: APIRequestContext,
      input: { workspaceId: string; connectedSources: [] },
    ) => Promise<unknown>
  >((value) => typeof value === "function"),
});

const REFUSAL = '{"field":"unreadableReason","rule":"must have no space for a text layer"}';

const harnessRefusing = async () => {
  const server = createServer((_, response) => {
    response.writeHead(400, { "content-type": "application/json" }).end(REFUSAL);
  });
  await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
  const address = server.address();
  assert(address !== null && typeof address === "object", "the server listens on a port");
  const { port } = address;
  const api = await request.newContext({ baseURL: `http://127.0.0.1:${port}` });
  return {
    api,
    close: async () => {
      await api.dispose();
      await new Promise((closed) => server.close(closed));
    },
  };
};

describe("the browser suite's seed call", () => {
  it("names the status, field and rule of a refusal", async () => {
    const harness = aHarness.parse(
      await import(pathToFileURL(path.join(workspaceRoot, "e2e/harness.ts")).href),
    );
    const refusing = await harnessRefusing();

    try {
      await expect(
        harness.seedConnectedSources(refusing.api, { workspaceId: "w", connectedSources: [] }),
      ).rejects.toThrow(/answered 400.*unreadableReason.*must have no space/s);
    } finally {
      await refusing.close();
    }
  });
});
