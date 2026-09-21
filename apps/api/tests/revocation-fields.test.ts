import { describe, expect, it } from "vitest";

import { authAsServerBuildsIt } from "./auth-instance.ts";

const { auth } = authAsServerBuildsIt();

type Declared = { type?: unknown; required?: unknown; input?: unknown; returned?: unknown };

const platformWritten = (field: Declared | undefined): Readonly<Record<string, unknown>> => ({
  type: field?.type,
  required: field?.required,
  input: field?.input,
});

const PLATFORM_DATE = { type: "date", required: false, input: false };

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

describe("the revocation instants the identity provider carries", () => {
  it("gives a person one instant on their user row, which the person cannot set", () => {
    const fields: Record<string, Declared> = auth.options.user.additionalFields;

    expect(platformWritten(fields["credentialsRevokedAt"])).toEqual(PLATFORM_DATE);
  });

  it("gives a membership its own instant, so one workspace's revocation stays there", () => {
    const fields = memberSchema()?.additionalFields ?? {};

    expect(platformWritten(fields["credentialsRevokedAt"])).toEqual(PLATFORM_DATE);
  });

  it("keeps the membership instant out of what a colleague is shown", () => {
    const fields = memberSchema()?.additionalFields ?? {};

    expect(fields["credentialsRevokedAt"]?.returned).toBe(false);
  });
});
