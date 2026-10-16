import { createServer, type Server } from "node:net";

import { serve } from "@hono/node-server";
import type { Hono } from "hono";

export type Held = { readonly server: Server; readonly port: number };

export const heldPort = async (): Promise<Held> => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port was bound");
  return { server, port: address.port };
};

export const released = (held: Held): Promise<void> =>
  new Promise((resolve) => held.server.close(() => resolve()));

/** A port free a moment ago; another process may bind it before the caller does. */
export const freePort = async (): Promise<number> => {
  const held = await heldPort();
  await released(held);
  return held.port;
};

export const servedOnLoopback = async (
  server: Hono,
  work: (origin: string) => Promise<void>,
): Promise<void> => {
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
