import { Pool } from "pg";
import { pino } from "pino";

import { openPostgres } from "@better-answers/core/store/postgres";

import { createAuth } from "../src/auth/index.ts";
import { AUTH_SECRET, MCP_URL, PUBLIC_URL } from "./harness.ts";

type BuiltAuth = { readonly auth: ReturnType<typeof createAuth>; readonly database: Pool };

export const authAsServerBuildsIt = (): BuiltAuth => {
  const database = new Pool({ connectionString: "postgresql://unused@127.0.0.1:1/unused" });
  const auth = createAuth({
    database,
    door: openPostgres(database),
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
