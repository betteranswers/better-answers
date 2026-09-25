import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  invitation,
  INVITATION_CANCELLED_STATUS,
  INVITATION_EXPIRY_SECONDS,
  INVITATION_WAITING_STATUS,
} from "@better-answers/schema";

import { authAsServerBuildsIt } from "./auth-instance.ts";

const { auth } = authAsServerBuildsIt();

type Field = {
  type?: unknown;
  required?: unknown;
  fieldName?: unknown;
  defaultValue?: unknown;
};

type OrganisationPlugin = {
  schema?: { invitation?: { fields?: Record<string, Field> } };
  options?: { invitationExpiresIn?: unknown };
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

const platformKey = (key: string, field: Field): string =>
  typeof field.fieldName === "string" ? field.fieldName : key;

const columns = (): Readonly<Record<string, { notNull: boolean; hasDefault: boolean }>> =>
  getTableColumns(invitation);

describe("the invitation an approved access request mints", () => {
  it("carries exactly the columns the organisation plugin declares", () => {
    const declared = Object.entries(invitationFields()).map(([key, field]) =>
      platformKey(key, field),
    );

    expect(Object.keys(columns()).toSorted()).toEqual([...declared, "id"].toSorted());
  });

  it("makes each column as optional as the plugin says", () => {
    for (const [key, field] of Object.entries(invitationFields())) {
      const column = columns()[platformKey(key, field)];
      expect({ key, notNull: column?.notNull }).toEqual({ key, notNull: field.required === true });
    }
  });

  it("starts an invitation at the plugin's default status, pending", () => {
    const status = invitationFields()["status"];
    expect(status?.defaultValue).toBe("pending");
    expect(INVITATION_WAITING_STATUS).toBe("pending");
    expect(columns()["status"]?.hasDefault).toBe(true);
  });

  it("cancels in the plugin's own word, which its reads speak", () => {
    expect(INVITATION_CANCELLED_STATUS).toBe("canceled");
  });

  it("expires an invitation after seven days, as the plugin says", () => {
    expect(INVITATION_EXPIRY_SECONDS).toBe(604_800);
    expect(organisationPlugin()?.options?.invitationExpiresIn).toBe(604_800);
  });
});
