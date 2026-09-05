import { getAuthTables } from "better-auth/db";
import { Pool } from "pg";
import { pino } from "pino";
import { describe, expect, it } from "vitest";

import { openPostgres } from "@better-answers/core/store/postgres";

import { createAuth } from "../src/auth/index.ts";
import { AUTH_SECRET, MCP_URL, PUBLIC_URL } from "./harness.ts";

/**
 * The two revocation instants Better Auth is told about (ADR 0035): the person's, on
 * the user row, and the membership's, on the member row. Both are read back out of the
 * library's own resolved table map rather than out of our options object, because what
 * matters is that the library agrees the column exists and that it refuses to take
 * either from a person's input — a field the person could set would let the revoked
 * revoke their own revocation.
 *
 * The pool is never connected: `getAuthTables` reads the plugin list, not the database
 * (the endpoint-snapshot suite explains the same trick at greater length).
 */

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

const tables = getAuthTables(auth.options);

describe("the revocation instants the identity provider carries", () => {
  it("gives a person one instant on their user row, which the person cannot set", () => {
    const field = tables["user"]?.fields["credentialsRevokedAt"];

    expect(field?.type).toBe("date");
    expect(field?.required ?? false).toBe(false);
    expect(field?.input).toBe(false);
  });

  it("gives a membership its own instant, so one workspace's revocation stays there", () => {
    const field = tables["member"]?.fields["credentialsRevokedAt"];

    expect(field?.type).toBe("date");
    expect(field?.required ?? false).toBe(false);
    expect(field?.input).toBe(false);
  });
});
