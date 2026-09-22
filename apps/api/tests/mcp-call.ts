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
