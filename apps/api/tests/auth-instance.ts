import type { Pool } from "pg";
import { pino } from "pino";

import { createAuth } from "../src/auth/index.ts";
import { AUTH_SECRET, doorsFor, MCP_URL, PUBLIC_URL } from "./harness.ts";

type BuiltAuth = { readonly auth: ReturnType<typeof createAuth>; readonly database: Pool };

export const authAsServerBuildsIt = (): BuiltAuth => {
  const doors = doorsFor("postgresql://unused@127.0.0.1:1/unused");
  const database = doors.postgres.pool;
  const auth = createAuth({
    database,
    door: doors.postgres,
    publicUrl: PUBLIC_URL,
    mcpUrl: MCP_URL,
    secret: AUTH_SECRET,
    sendEmail: async () => {},
    fetchClientMetadataResource: async () => new Response("", { status: 404 }),
    logger: pino({ level: "silent" }),
  });
  auth.$context.catch(() => {});
  return { auth, database };
};
