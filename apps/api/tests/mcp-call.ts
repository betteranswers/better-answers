import { expect } from "vitest";

import type { TestClient } from "./harness.ts";

export const callMcp = (
  client: TestClient,
  token: string,
  method: string,
  params: Readonly<Record<string, unknown>> = {},
): Promise<Response> =>
  client.fetch("/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
      "mcp-protocol-version": "2025-11-25",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });

export type Rpc = Readonly<Record<string, unknown>>;

const isRpc = (value: unknown): value is Rpc =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Anything but a plain object reads as an empty one. */
export const rpcOf = (value: unknown): Rpc => (isRpc(value) ? value : {});

/** The list's objects alone; anything but a list reads as empty. */
export const rpcListOf = (value: unknown): readonly Rpc[] =>
  Array.isArray(value) ? value.filter(isRpc) : [];

/** Fails the test when the call answers an error, or the tool reports one. */
export const calledTool = async (
  client: TestClient,
  token: string,
  name: string,
  args: Rpc,
): Promise<Rpc> => {
  const response = await callMcp(client, token, "tools/call", { name, arguments: args });
  const text = await response.text();
  /** The surface answers an event stream, and the tool's answer is its last frame. */
  const streamed = [...text.matchAll(/^data:(.*)$/gm)].at(-1)?.[1];
  const body = rpcOf(JSON.parse(streamed ?? text));
  expect(body["error"]).toBeUndefined();
  const result = rpcOf(body["result"]);
  expect(result["isError"]).toBeFalsy();
  return result;
};

export const structured = (result: Rpc): Rpc => rpcOf(result["structuredContent"]);

/** The first content item's text; the string `undefined` when there is no such text. */
export const rendered = (result: Rpc): string =>
  String(rpcOf(rpcListOf(result["content"])[0])["text"]);
