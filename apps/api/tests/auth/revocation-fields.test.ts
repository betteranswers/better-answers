import { assert, describe, expect, it } from "vitest";

import { authAsServerBuildsIt } from "../support/auth-instance.ts";

const { auth } = authAsServerBuildsIt();

type Declared = { type?: unknown; required?: unknown; input?: unknown; returned?: unknown };

const writeRulesOf = (field: Declared | undefined): Readonly<Record<string, unknown>> => ({
  type: field?.type,
  required: field?.required,
  input: field?.input,
});

const SERVER_SET_DATE = { type: "date", required: false, input: false };

const memberSchema = (): { additionalFields?: Record<string, Declared> } | undefined => {
  const plugins: readonly unknown[] = auth.options.plugins;
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

describe("the credential revocation timestamps Better Auth declares", () => {
  it("declares a user-row timestamp the person cannot set", () => {
    const fields: Record<string, Declared> = auth.options.user.additionalFields;

    expect(writeRulesOf(fields["credentialsRevokedAt"])).toEqual(SERVER_SET_DATE);
  });

  it("declares a separate member-row timestamp for each workspace", () => {
    const schema = memberSchema();
    assert(
      schema?.additionalFields !== undefined,
      "the organisation plugin declares no member fields",
    );
    const fields = schema.additionalFields;

    expect(writeRulesOf(fields["credentialsRevokedAt"])).toEqual(SERVER_SET_DATE);
  });

  it("omits the member's timestamp from what the API returns", () => {
    const schema = memberSchema();
    assert(
      schema?.additionalFields !== undefined,
      "the organisation plugin declares no member fields",
    );
    const fields = schema.additionalFields;

    expect(fields["credentialsRevokedAt"]?.returned).toBe(false);
  });
});
