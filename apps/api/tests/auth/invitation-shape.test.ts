import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  invitation,
  INVITATION_CANCELLED_STATUS,
  INVITATION_EXPIRY_SECONDS,
  INVITATION_WAITING_STATUS,
} from "@better-answers/schema";

import { authAsServerBuildsIt } from "../support/auth-instance.ts";

const { auth } = authAsServerBuildsIt();

type Field = {
  type?: unknown;
  required?: unknown;
  fieldName?: unknown;
  defaultValue?: unknown;
};

type OrganisationPlugin = {
  schema?: { invitation?: { fields?: Record<string, Field> } };
};

const organisationPlugin = (): OrganisationPlugin | undefined => {
  const plugins: readonly unknown[] = auth.options.plugins;
  return plugins.find(
    (plugin): plugin is OrganisationPlugin =>
      typeof plugin === "object" &&
      plugin !== null &&
      "id" in plugin &&
      plugin.id === "organization",
  );
};

const invitationFields = (): Readonly<Record<string, Field>> =>
  organisationPlugin()?.schema?.invitation?.fields ?? {};

const EXPIRY_OPTIONS = z.object({ options: z.object({ invitationExpiresIn: z.number() }) });

const columnNameOf = (key: string, field: Field): string =>
  typeof field.fieldName === "string" ? field.fieldName : key;

const columns = (): Readonly<Record<string, { notNull: boolean; hasDefault: boolean }>> =>
  getTableColumns(invitation);

describe("the invitation created when an access request is approved", () => {
  it("has exactly the columns the organisation plugin declares", () => {
    const declared = Object.entries(invitationFields()).map(([key, field]) =>
      columnNameOf(key, field),
    );

    expect(Object.keys(columns()).toSorted()).toEqual([...declared, "id"].toSorted());
  });

  it("matches each column's nullability to the plugin's required flag", () => {
    for (const [key, field] of Object.entries(invitationFields())) {
      const column = columns()[columnNameOf(key, field)];
      expect({ key, notNull: column?.notNull }).toEqual({ key, notNull: field.required === true });
    }
  });

  it("defaults the status to pending, as the plugin does", () => {
    const status = invitationFields()["status"];
    expect(status?.defaultValue).toBe("pending");
    expect(INVITATION_WAITING_STATUS).toBe("pending");
    expect(columns()["status"]?.hasDefault).toBe(true);
  });

  it("uses the plugin's spelling canceled for a cancelled invitation", () => {
    expect(INVITATION_CANCELLED_STATUS).toBe("canceled");
  });

  it("expires after seven days, matching the plugin's setting", () => {
    expect(INVITATION_EXPIRY_SECONDS).toBe(604_800);
    expect(EXPIRY_OPTIONS.parse(organisationPlugin()).options.invitationExpiresIn).toBe(604_800);
  });
});
