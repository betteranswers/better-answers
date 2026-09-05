import { Pool } from "pg";
import { pino } from "pino";
import { describe, expect, it } from "vitest";

import { openPostgres } from "@better-answers/core/store/postgres";

import { createAuth } from "../src/auth/index.ts";
import { AUTH_SECRET, MCP_URL, PUBLIC_URL } from "./harness.ts";

/**
 * The two revocation instants the identity provider is told about (ADR 0035): the
 * person's, on the user row, and the membership's, on the organisation plugin's member
 * schema. Both are read off an instance built the way `createServer` builds one — the
 * same `createAuth` with the same options — rather than off the source, because what
 * has to hold is that the library carries the declaration — a
 * column the library does not know is a column its own writes would drop — and that
 * neither instant is taken from a person's input, since a field a person could set
 * would let the revoked revoke their own revocation.
 *
 * The pool is never connected: the options are the plugin list's, not the database's
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

/** A field as the library holds it: a type, and who may set it or see it. */
type Declared = { type?: unknown; required?: unknown; input?: unknown; returned?: unknown };

// Every key read as it stands, no default filled in: the library reads an omitted
// `required` as true and an omitted `input` as settable, so a defaulted comparison
// would pass a declaration that says neither.
const platformWritten = (field: Declared | undefined): Readonly<Record<string, unknown>> => ({
  type: field?.type,
  required: field?.required,
  input: field?.input,
});

const PLATFORM_DATE = { type: "date", required: false, input: false };

/** The organisation plugin's member schema, off the built instance's plugin list. */
const memberSchema = (): { additionalFields?: Record<string, Declared> } | undefined => {
  const plugins: readonly unknown[] = auth.options.plugins ?? [];
  const organisation = plugins.find(
    (
      plugin,
    ): plugin is {
      options: { schema?: { member?: { additionalFields?: Record<string, Declared> } } };
    } =>
      typeof plugin === "object" &&
      plugin !== null &&
      "id" in plugin &&
      plugin.id === "organization",
  );
  return organisation?.options.schema?.member;
};

describe("the revocation instants the identity provider carries", () => {
  it("gives a person one instant on their user row, which the person cannot set", () => {
    const fields: Record<string, Declared> = auth.options.user?.additionalFields ?? {};

    expect(platformWritten(fields["credentialsRevokedAt"])).toEqual(PLATFORM_DATE);
  });

  it("gives a membership its own instant, so one workspace's revocation stays there", () => {
    const fields = memberSchema()?.additionalFields ?? {};

    expect(platformWritten(fields["credentialsRevokedAt"])).toEqual(PLATFORM_DATE);
  });

  it("keeps the membership instant out of what a colleague is shown", () => {
    // A member list is other people's rows: when a colleague was revoked here is
    // nobody else's business, and nothing of ours reads the column through the library.
    const fields = memberSchema()?.additionalFields ?? {};

    expect(fields["credentialsRevokedAt"]?.returned).toBe(false);
  });
});
