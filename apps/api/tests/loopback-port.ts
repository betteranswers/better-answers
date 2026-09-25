import { createServer, type Server } from "node:net";

export type Held = { readonly server: Server; readonly port: number };

/** A loopback port bound and kept, so nothing else takes it until it is `released`. */
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
