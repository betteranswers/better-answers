import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { invitation, INVITATION_EXPIRY_SECONDS } from "@better-answers/schema";

import { authAsServerBuildsIt } from "./auth-instance.ts";

const { auth } = authAsServerBuildsIt();

type Field = {
  type?: unknown;
  required?: unknown;
  fieldName?: unknown;
  defaultValue?: unknown;
};

const invitationFields = (): Readonly<Record<string, Field>> => {
  const plugins: readonly unknown[] = auth.options.plugins;
  const organisation = plugins.find(
    (plugin): plugin is { schema?: { invitation?: { fields?: Record<string, Field> } } } =>
      typeof plugin === "object" &&
      plugin !== null &&
      "id" in plugin &&
      plugin.id === "organization",
  );
  return organisation?.schema?.invitation?.fields ?? {};
};

const platformKey = (key: string, field: Field): string =>
  typeof field.fieldName === "string" ? field.fieldName : key;

const columns = (): Readonly<Record<string, { notNull: boolean; hasDefault: boolean }>> =>
  getTableColumns(invitation);

const expirySecondsInInstalledPlugin = (): number => {
  const entry = createRequire(import.meta.url).resolve("better-auth");
  const adapter = path.resolve(path.dirname(entry), "plugins/organization/adapter.mjs");
  const matches = [
    ...readFileSync(adapter, "utf8").matchAll(/invitationExpiresIn\s*\|\|\s*([\d\s*]+?)\s*,/g),
  ];
  expect(matches).toHaveLength(1);
  const expression = matches[0]?.[1] ?? "";
  return expression.split("*").reduce((product, factor) => product * Number(factor.trim()), 1);
};

describe("the invitation an approved access request mints", () => {
  it("carries every column the organisation plugin declares, and no column it does not", () => {
    const declared = Object.entries(invitationFields()).map(([key, field]) =>
      platformKey(key, field),
    );

    expect(Object.keys(columns()).toSorted()).toEqual([...declared, "id"].toSorted());
  });

  it("makes each column as optional as the plugin says, so a direct write cannot miss a required one", () => {
    for (const [key, field] of Object.entries(invitationFields())) {
      const column = columns()[platformKey(key, field)];
      expect({ key, notNull: column?.notNull }).toEqual({ key, notNull: field.required === true });
    }
  });

  it("starts an invitation at the status the plugin defaults it to, so the row reads as pending", () => {
    const status = invitationFields()["status"];
    expect(status?.defaultValue).toBe("pending");
    expect(columns()["status"]?.hasDefault).toBe(true);
  });

  it("expires an invitation at the plugin's own default, pinned to the installed source", () => {
    const seconds = expirySecondsInInstalledPlugin();
    expect(seconds).toBeGreaterThan(0);
    expect(INVITATION_EXPIRY_SECONDS).toBe(seconds);
  });
});
