import { byCodeUnit } from "@better-answers/schema/code-unit";

import type { PlatformPrincipal } from "../kernel/index.ts";
import { historyNaming, type GitDoor, type Needles } from "../store/git/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import { SESSION_VERIFICATION_PREFIXES, VERIFICATION_PREFIXES } from "../workspaces/index.ts";
import { documentsNaming } from "./documents.ts";
import { soughtIdentifiersOf, type SoughtIdentifier } from "./identifiers.ts";
import type { SubjectNamed } from "./needles.ts";
import { askersOf } from "./questions.ts";
import type { SubjectIdentifiers, SubjectRequest } from "./requests.ts";

export const ERASURE_FAMILIES = [
  "concept-file",
  "bundle-commit",
  "concept-verification",
  "identity-user",
  "identity-session",
  "identity-verification",
  "identity-invitation",
  "identity-account",
  "identity-passkey",
  "identity-authenticator",
  "identity-recovery-code",
  "identity-confirm-failures",
  "identity-last-active",
  "source-document",
  "question-asked",
  "concept-sensitivity-override",
  "finding",
  "suggestion",
  "concept-write-request",
  "concept-owner",
  "write-up-version",
  "guide-definition-version",
  "usage",
] as const;

export type ErasureFamily = (typeof ERASURE_FAMILIES)[number];

export const PERSONAL_DATA_CATEGORIES = [
  "actor-id",
  "name",
  "email-address",
  "sign-in",
  "ip-address",
  "device",
  "linked-account",
  "document-text",
  "typed-text",
] as const;

type PersonalDataCategory = (typeof PERSONAL_DATA_CATEGORIES)[number];

type SubjectHere = {
  readonly workspaceId: string;

  readonly emails: readonly string[];

  readonly memberId: string | null;

  readonly needles: Needles;

  readonly identifiers: readonly SoughtIdentifier[];
};

type ErasureFinder = (
  platform: PlatformPrincipal,
  subject: SubjectHere,
  tx: Tx,
  door: GitDoor,
) => Promise<readonly string[]>;

export type ErasureFamilyDescriptor = {
  readonly categories: readonly PersonalDataCategory[];
  readonly find: ErasureFinder;
};

type ErasureMapEntry = {
  readonly family: ErasureFamily;
  readonly categories: readonly PersonalDataCategory[];
  readonly locations: readonly string[];
};

export type ErasureMap = readonly ErasureMapEntry[];

const located = async (
  tx: Tx,
  statement: string,
  parameters: readonly unknown[],
): Promise<readonly string[]> => {
  const found = await tx.query<{ location: string }>(statement, [...parameters]);
  return found.rows.map((row) => row.location);
};

const aboutTheActors = async (
  tx: Tx,
  subject: SubjectHere,
  statement: string,
): Promise<readonly string[]> => {
  const actors = askersOf(subject.needles.people);
  return actors.length === 0 ? [] : located(tx, statement, [subject.workspaceId, actors]);
};

const aboutTheMember = async (
  tx: Tx,
  subject: SubjectHere,
  statement: string,
  extras: readonly unknown[] = [],
): Promise<readonly string[]> =>
  subject.memberId === null ? [] : located(tx, statement, [subject.memberId, ...extras]);

const rowsOfThePersonIn =
  (table: "account" | "authenticator" | "recovery_code"): ErasureFinder =>
  (platform, subject, tx) =>
    aboutTheMember(tx, subject, `SELECT id AS location FROM ${table} WHERE user_id = $1`);

const ERASURE_FAMILY_DESCRIPTORS = {
  "concept-file": {
    categories: ["actor-id", "email-address", "name"],
    find: async (platform, subject, tx, door) => {
      const named = await historyNaming(platform, door, subject.workspaceId, [
        ...new Set([...subject.emails, ...subject.needles.addresses, ...subject.needles.people]),
      ]);
      return [
        ...named.blobs.map((blob) => `${blob.commit}:${blob.path}`),
        ...named.authors.map((sha) => `${sha} (author line)`),
      ];
    },
  },

  "bundle-commit": {
    categories: ["actor-id"],
    find: (platform, subject, tx) =>
      aboutTheActors(
        tx,
        subject,
        "SELECT sha AS location FROM bundle_commit WHERE workspace_id = $1 AND actor = ANY($2)",
      ),
  },

  "concept-verification": {
    categories: ["actor-id"],
    find: (platform, subject, tx) =>
      aboutTheActors(
        tx,
        subject,
        "SELECT id AS location FROM concept_verification WHERE workspace_id = $1 AND actor = ANY($2)",
      ),
  },

  "identity-user": {
    categories: ["name", "email-address"],
    find: (platform, subject, tx) =>
      aboutTheMember(tx, subject, `SELECT id AS location FROM "user" WHERE id = $1`),
  },

  "identity-session": {
    categories: ["sign-in", "ip-address", "device"],
    find: (platform, subject, tx) =>
      aboutTheMember(tx, subject, "SELECT id AS location FROM session WHERE user_id = $1"),
  },

  "identity-verification": {
    categories: ["email-address"],
    find: (platform, subject, tx) =>
      aboutTheMember(
        tx,
        subject,
        `SELECT id AS location FROM verification
          WHERE lower(identifier) IN (SELECT prefix || lower(u.email)
                                        FROM "user" u, unnest($2::text[]) AS prefix
                                       WHERE u.id = $1)
             OR identifier IN (SELECT prefix || s.id
                                 FROM session s, unnest($3::text[]) AS prefix
                                WHERE s.user_id = $1)`,
        [[...VERIFICATION_PREFIXES], [...SESSION_VERIFICATION_PREFIXES]],
      ),
  },

  "identity-invitation": {
    categories: ["email-address"],
    find: (platform, subject, tx) =>
      aboutTheMember(
        tx,
        subject,
        `SELECT id AS location FROM invitation
          WHERE workspace_id = $2
            AND (lower(email) = ANY($3)
                 OR lower(email) = (SELECT lower(email) FROM "user" WHERE id = $1))`,
        [subject.workspaceId, subject.emails],
      ),
  },

  "identity-account": {
    categories: ["linked-account"],
    find: rowsOfThePersonIn("account"),
  },

  "identity-passkey": {
    categories: ["sign-in", "device"],
    find: (platform, subject, tx) =>
      aboutTheMember(
        tx,
        subject,
        `SELECT id AS location FROM passkey WHERE user_id = $1
         UNION ALL
         SELECT u.passkey_id || ' (last use)' AS location
           FROM passkey_last_use u JOIN passkey p ON p.id = u.passkey_id
          WHERE p.user_id = $1`,
      ),
  },

  "identity-authenticator": {
    categories: ["sign-in"],
    find: rowsOfThePersonIn("authenticator"),
  },

  "identity-recovery-code": {
    categories: ["sign-in"],
    find: rowsOfThePersonIn("recovery_code"),
  },

  "identity-confirm-failures": {
    categories: ["sign-in"],
    find: (platform, subject, tx) =>
      aboutTheMember(
        tx,
        subject,
        "SELECT kind AS location FROM second_factor_throttle WHERE user_id = $1",
      ),
  },

  "identity-last-active": {
    categories: ["sign-in"],
    find: (platform, subject, tx) =>
      aboutTheMember(
        tx,
        subject,
        `SELECT workspace_id AS location FROM workspace_last_active
          WHERE user_id = $1 AND workspace_id = $2`,
        [subject.workspaceId],
      ),
  },

  "source-document": {
    categories: ["document-text"],
    find: (platform, subject, tx) => documentsNaming(platform, tx, subject),
  },

  "question-asked": {
    categories: ["actor-id", "typed-text"],
    find: (platform, subject, tx) =>
      aboutTheActors(
        tx,
        subject,
        "SELECT id AS location FROM question_asked WHERE workspace_id = $1 AND asked_by = ANY($2)",
      ),
  },

  "concept-sensitivity-override": {
    categories: ["actor-id"],
    find: (platform, subject, tx) =>
      aboutTheActors(
        tx,
        subject,
        "SELECT iri AS location FROM concept_sensitivity_override WHERE workspace_id = $1 AND actor = ANY($2)",
      ),
  },

  finding: {
    categories: ["actor-id", "typed-text"],
    find: (platform, subject, tx) =>
      aboutTheActors(
        tx,
        subject,
        `SELECT id AS location FROM finding
          WHERE workspace_id = $1 AND (reviewed_by = ANY($2) OR restored_by = ANY($2))`,
      ),
  },

  suggestion: {
    categories: ["actor-id", "typed-text"],
    find: (platform, subject, tx) =>
      aboutTheActors(
        tx,
        subject,
        `SELECT id AS location FROM suggestion
          WHERE workspace_id = $1 AND (proposer = ANY($2) OR decider = ANY($2))`,
      ),
  },

  "concept-write-request": {
    categories: ["actor-id", "email-address"],
    find: (platform, subject, tx) =>
      located(
        tx,
        "SELECT concept_write_requests_naming AS location FROM concept_write_requests_naming($1, $2)",
        [subject.needles.people, subject.needles.addresses],
      ),
  },

  "concept-owner": {
    categories: ["actor-id"],
    find: (platform, subject, tx) =>
      aboutTheMember(
        tx,
        subject,
        "SELECT id AS location FROM concept_owner WHERE person_id = $1 AND workspace_id = $2",
        [subject.workspaceId],
      ),
  },

  "write-up-version": {
    categories: ["actor-id"],
    find: (platform, subject, tx) =>
      aboutTheActors(
        tx,
        subject,
        `SELECT write_up_id || ' (version ' || version || ')' AS location FROM write_up_version
          WHERE workspace_id = $1 AND actor = ANY($2)`,
      ),
  },

  "guide-definition-version": {
    categories: ["actor-id"],
    find: (platform, subject, tx) =>
      aboutTheActors(
        tx,
        subject,
        `SELECT guide_id || ' (version ' || version || ')' AS location FROM guide_definition_version
          WHERE workspace_id = $1 AND actor = ANY($2)`,
      ),
  },

  usage: {
    categories: ["actor-id"],
    find: (platform, subject, tx) =>
      aboutTheActors(
        tx,
        subject,
        "SELECT id AS location FROM usage WHERE workspace_id = $1 AND actor = ANY($2)",
      ),
  },
} satisfies Record<ErasureFamily, ErasureFamilyDescriptor>;

const soughtWithTheSignInAddresses = (
  identifiers: SubjectIdentifiers,
  signInAddresses: readonly string[],
): readonly SoughtIdentifier[] =>
  soughtIdentifiersOf({ ...identifiers, emails: [...identifiers.emails, ...signInAddresses] });

const subjectHereOf = (request: SubjectRequest, named: SubjectNamed): SubjectHere => ({
  workspaceId: request.workspaceId,
  emails: request.identifiers.emails.map((email) => email.trim().toLowerCase()),
  memberId: named.member,
  needles: named.needles,
  identifiers: soughtWithTheSignInAddresses(request.identifiers, named.signInAddresses),
});

export const erasureMapOf = async (
  platform: PlatformPrincipal,
  tx: Tx,
  door: GitDoor,
  request: SubjectRequest,
  named: SubjectNamed,
): Promise<ErasureMap> => {
  const subject = subjectHereOf(request, named);

  const entries: ErasureMapEntry[] = [];
  for (const family of ERASURE_FAMILIES) {
    const descriptor = ERASURE_FAMILY_DESCRIPTORS[family];
    // oxlint-disable-next-line eslint/no-await-in-loop -- every family's search runs on the erasure's transaction
    const found = await descriptor.find(platform, subject, tx, door);

    entries.push({
      family,
      categories: descriptor.categories,
      locations: [...found].sort(byCodeUnit),
    });
  }
  return entries;
};

type AccessAnswerLocation = {
  readonly family: ErasureFamily;
  readonly categories: readonly PersonalDataCategory[];
  readonly location: string;
};

export type AccessAnswer = {
  readonly categories: readonly PersonalDataCategory[];
  readonly locations: readonly AccessAnswerLocation[];
};

export const accessAnswerOf = (map: ErasureMap): AccessAnswer => {
  const locations = map.flatMap((entry) =>
    entry.locations.map((location) => ({
      family: entry.family,
      categories: entry.categories,
      location,
    })),
  );
  const held = new Set(locations.flatMap((named) => named.categories));
  return {
    categories: PERSONAL_DATA_CATEGORIES.filter((category) => held.has(category)),
    locations,
  };
};
