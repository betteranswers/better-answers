import { boundarySchemas } from "@better-answers/schema";
import { byCodeUnit } from "@better-answers/schema/code-unit";

import { actorIdOfPerson, type ActorId, type PlatformPrincipal } from "../kernel/index.ts";
import { historyNaming, type GitDoor } from "../store/git/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import { SESSION_VERIFICATION_PREFIXES, VERIFICATION_PREFIXES } from "../workspaces/index.ts";
import { documentsNaming } from "./documents.ts";
import { soughtIdentifiersOf, type SoughtIdentifier } from "./identifiers.ts";
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
] as const;

type PersonalDataCategory = (typeof PERSONAL_DATA_CATEGORIES)[number];

type SubjectHere = {
  readonly workspaceId: string;

  readonly emails: readonly string[];

  readonly actor: ActorId | null;

  readonly memberId: string | null;

  readonly needles: readonly string[];

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

const aboutTheActor = async (
  tx: Tx,
  subject: SubjectHere,
  statement: string,
): Promise<readonly string[]> =>
  subject.actor === null ? [] : located(tx, statement, [subject.workspaceId, subject.actor]);

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

const MEMBER_HERE = `SELECT u.id AS location
     FROM "user" u
     JOIN member m ON m.user_id = u.id
    WHERE m.workspace_id = $1 AND (u.id = $2 OR lower(u.email) = ANY($3))
    LIMIT 1`;

/**
 * The suppression adds the addresses the person signs in with, so the documents naming them are
 * the ones its erasure re-indexes.
 */
const SIGN_IN_ADDRESSES = `SELECT email AS location FROM "user" WHERE id = ANY($1::text[])`;

const ERASURE_FAMILY_DESCRIPTORS = {
  "concept-file": {
    categories: ["actor-id", "email-address", "name"],
    find: async (platform, subject, tx, door) => {
      const named = await historyNaming(platform, door, subject.workspaceId, subject.needles);
      return [
        ...named.blobs.map((blob) => `${blob.commit}:${blob.path}`),
        ...named.authors.map((sha) => `${sha} (author line)`),
      ];
    },
  },

  "bundle-commit": {
    categories: ["actor-id"],
    find: (platform, subject, tx) =>
      aboutTheActor(
        tx,
        subject,
        "SELECT sha AS location FROM bundle_commit WHERE workspace_id = $1 AND actor = $2",
      ),
  },

  "concept-verification": {
    categories: ["actor-id"],
    find: (platform, subject, tx) =>
      aboutTheActor(
        tx,
        subject,
        "SELECT id AS location FROM concept_verification WHERE workspace_id = $1 AND actor = $2",
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

  /** Keyed by an address, or by one of the person's sessions. */
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

  /** A passkey's last use sits in its own row, named after the passkey it belongs to. */
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

  /** One row a kind of code, named by the kind: the row has no id of its own. */
  "identity-confirm-failures": {
    categories: ["sign-in"],
    find: (platform, subject, tx) =>
      aboutTheMember(
        tx,
        subject,
        "SELECT kind AS location FROM second_factor_throttle WHERE user_id = $1",
      ),
  },

  /** This workspace's row alone: another's would say where else the person has been. */
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
} satisfies Record<ErasureFamily, ErasureFamilyDescriptor>;

const soughtWithTheSignInAddresses = (
  identifiers: SubjectIdentifiers | null,
  signInAddresses: readonly string[],
): readonly SoughtIdentifier[] =>
  soughtIdentifiersOf({
    emails: [...(identifiers?.emails ?? []), ...signInAddresses],
    names: identifiers?.names ?? [],
    other: identifiers?.other ?? [],
  });

const subjectHereOf = async (tx: Tx, request: SubjectRequest): Promise<SubjectHere> => {
  const emails = (request.identifiers?.emails ?? []).map((email) => email.trim().toLowerCase());

  const personId =
    request.personId === null ? null : boundarySchemas.user.select.shape.id.parse(request.personId);
  const [memberId = null] = await located(tx, MEMBER_HERE, [request.workspaceId, personId, emails]);
  const signInAddresses = await located(tx, SIGN_IN_ADDRESSES, [
    [memberId, personId].filter((id) => id !== null),
  ]);
  return {
    workspaceId: request.workspaceId,
    emails,
    actor: personId === null ? null : actorIdOfPerson(personId),
    memberId,

    needles: personId === null ? emails : [...emails, personId],
    identifiers: soughtWithTheSignInAddresses(request.identifiers, signInAddresses),
  };
};

/** Reads only. One entry per family, in `ERASURE_FAMILIES` order, its locations sorted. */
export const erasureMapOf = async (
  platform: PlatformPrincipal,
  tx: Tx,
  door: GitDoor,
  request: SubjectRequest,
): Promise<ErasureMap> => {
  const subject = await subjectHereOf(tx, request);

  const entries: ErasureMapEntry[] = [];
  for (const family of ERASURE_FAMILIES) {
    const descriptor = ERASURE_FAMILY_DESCRIPTORS[family];
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

/** Only the categories some location holds, in `PERSONAL_DATA_CATEGORIES` order. */
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
