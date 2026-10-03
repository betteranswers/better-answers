import type { Pool } from "pg";
import { pino } from "pino";
import { afterAll } from "vitest";

import { systemClock } from "@better-answers/core/kernel";

import { createAuth } from "../src/auth/index.ts";
import { AUTH_SECRET, doorsFor, PUBLIC_URL, type TestApp } from "./harness.ts";

type Auth = ReturnType<typeof createAuth>;

type BuiltAuth = { readonly auth: Auth; readonly database: Pool };

const authOverDoor = (door: TestApp["doors"]["postgres"], publicUrl = PUBLIC_URL): Auth =>
  createAuth({
    database: door.pool,
    door,
    publicUrl,
    mcpUrl: `${publicUrl}/mcp`,
    secret: AUTH_SECRET,
    sendEmail: async () => {},
    fetchClientMetadataResource: async () => new Response("", { status: 404 }),
    logger: pino({ level: "silent" }),
    clock: systemClock(),
  });

/**
 * Over the TestApp's database, secret and origin, whose cookies it reads: an endpoint the router
 * refuses is still a server function.
 */
export const authOver = (app: TestApp): Auth => authOverDoor(app.doors.postgres, app.publicUrl);

/**
 * Over a pool that reaches no database, so fit for reading the instance's shape alone. The caller
 * ends `database`.
 */
export const authAsServerBuildsIt = (): BuiltAuth => {
  const doors = doorsFor("postgresql://unused@127.0.0.1:1/unused");
  const auth = authOverDoor(doors.postgres);
  auth.$context.catch(() => {});
  return { auth, database: doors.postgres.pool };
};

/** As `authAsServerBuildsIt`, its pool ended once the suite has run. */
export const authAsBuiltForSuite = (): Auth => {
  const { auth, database } = authAsServerBuildsIt();
  afterAll(async () => {
    await database.end();
  });
  return auth;
};
