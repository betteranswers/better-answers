import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { invitation, INVITATION_EXPIRY_SECONDS } from "@better-answers/schema";

import { authAsServerBuildsIt } from "./auth-instance.ts";

/**
 * What the organisation plugin says an invitation is — read off the installed plugin rather
 * than remembered (`[DEPS1]`), because `packages/core` writes an invitation row **directly**
 * when an Admin approves an access request (ADR 0038, T-061) instead of going through Better
 * Auth's endpoint. A direct write is only safe while the platform's own column list and the
 * library's agree: a column the plugin gained and this table lacks is a row its own reads
 * would come back short of, and an expiry the platform guessed is an invitation that outlives
 * or dies before the one the library would have written.
 *
 * Two questions, two sources. The **columns** come off an instance built the way
 * `createServer` builds one — the plugin's declared schema is decided by the option list and
 * by nothing else, which is why `auth-instance.ts` is shared with the endpoint snapshot and
 * the revocation-field suite. The **expiry default** is not on the instance at all: the
 * plugin falls back to it inside its adapter when the option is unset, so the value is read
 * out of the installed plugin's own source, exactly as `apps/worker/tests/pg_harness.py`
 * reads `POSTGRES_IMAGE` — one match or the read is refused (`[DEPS2]`).
 *
 * Neither question needs a database, so neither opens one.
 */

const { auth } = authAsServerBuildsIt();

/** A field as the plugin declares it. */
type Field = {
  type?: unknown;
  required?: unknown;
  fieldName?: unknown;
  defaultValue?: unknown;
};

const invitationFields = (): Readonly<Record<string, Field>> => {
  const plugins: readonly unknown[] = auth.options.plugins ?? [];
  const organisation = plugins.find(
    (plugin): plugin is { schema?: { invitation?: { fields?: Record<string, Field> } } } =>
      typeof plugin === "object" &&
      plugin !== null &&
      "id" in plugin &&
      plugin.id === "organization",
  );
  return organisation?.schema?.invitation?.fields ?? {};
};

/** The name the platform gives one of the plugin's fields — its own, unless we remapped it. */
const platformKey = (key: string, field: Field): string =>
  typeof field.fieldName === "string" ? field.fieldName : key;

const columns = (): Readonly<Record<string, { notNull: boolean; hasDefault: boolean }>> =>
  getTableColumns(invitation);

/**
 * The seconds the plugin falls back to when `invitationExpiresIn` is unset, read out of the
 * one line that holds it. More than one line matching means the library moved the fallback
 * and the read is no longer a pin, so the read fails rather than picking the first.
 */
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
    // Both directions (`[TEST7]`): one finds the column the library gained and this table
    // lacks, the other the column this table kept after the library dropped it. `id` is the
    // one addition — every model the library writes has one, declared by the adapter rather
    // than by the plugin's field list.
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
    // The approve act leaves `status` to the column's default rather than writing a word of
    // its own; this is the sentence that makes the column's default the library's.
    const status = invitationFields()["status"];
    expect(status?.defaultValue).toBe("pending");
    expect(columns()["status"]?.hasDefault).toBe(true);
  });

  it("expires an invitation at the plugin's own default, pinned to the installed source", () => {
    // Nothing configures `invitationExpiresIn`, so the plugin's fallback is what the
    // library's own invitation would carry — and it is what the approve act writes. The
    // number is not restated here: a second copy would be a second pin, and what the read
    // has to prove is only that it read seconds and not nothing.
    const seconds = expirySecondsInInstalledPlugin();
    expect(seconds).toBeGreaterThan(0);
    expect(INVITATION_EXPIRY_SECONDS).toBe(seconds);
  });
});
