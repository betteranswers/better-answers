import { z } from "zod";

import { boundarySchemas } from "@better-answers/schema";

import { endedGrant, latestOnIdentitySet, type EndedGrant } from "../audit/index.ts";
import {
  attempt,
  err,
  ok,
  type OperatorPrincipal,
  type Result,
  type Role,
  type UserId,
  type WorkspaceId,
} from "../kernel/index.ts";
import { containing, type Tx } from "../store/postgres/index.ts";
import { actorOf, type AuditEventActor, namesOfActors } from "./actors.ts";
import { grantNamed, type GrantNamed, type GrantNames, namesOfGrants } from "./grant-names.ts";
import { GRANTS_ENDED_HERE, REVOKED_EVERYWHERE } from "./grants.ts";
import { SIGN_IN_ACTS } from "./sign-in-and-consent.ts";
import type { WorkspaceRefusal } from "./vocabulary.ts";

const PAGE_LIMIT_DEFAULT = 50;

const PAGE_LIMIT_MAX = 100;

export const listPeopleInput = z.object({
  search: z.string().default(""),
  offset: z.int().min(0).default(0),
  limit: z.int().min(1).max(PAGE_LIMIT_MAX).default(PAGE_LIMIT_DEFAULT),
});

type ListPeopleInput = z.output<typeof listPeopleInput>;

type WorkspaceNamed = { readonly id: WorkspaceId; readonly name: string };

type PersonMembership = { readonly workspace: WorkspaceNamed; readonly role: Role };

type PersonListed = {
  readonly id: UserId;
  readonly displayName: string;
  readonly email: string;
  readonly memberships: readonly PersonMembership[];
  readonly lastSignedInAt: string | null;
  readonly credentialsRevokedAt: string | null;
};

type PeoplePage = {
  readonly people: readonly PersonListed[];
  /** Every match, not only this page's. */
  readonly total: number;
};

type PersonRow = {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly credentials_revoked_at: Date | null;
};

type MembershipRow = {
  readonly user_id: string;
  readonly role: string;
  readonly workspace_id: string;
  readonly workspace_name: string;
};

const MATCHING_PEOPLE = `"user" u WHERE u.name ILIKE $1 OR u.email ILIKE $1`;

const isoOf = (at: Date | null): string | null => (at === null ? null : at.toISOString());

const workspaceIdOf = (id: string): WorkspaceId =>
  boundarySchemas.workspace.select.shape.id.parse(id);

const pageOf = (tx: Tx, pattern: string, input: ListPeopleInput) =>
  tx.query<PersonRow>(
    `SELECT u.id, u.name, u.email, u.credentials_revoked_at
       FROM ${MATCHING_PEOPLE}
      ORDER BY lower(u.name), lower(u.email), u.id
      LIMIT $2 OFFSET $3`,
    [pattern, input.limit, input.offset],
  );

const membershipsOf = async (
  tx: Tx,
  personIds: readonly string[],
): Promise<ReadonlyMap<string, readonly PersonMembership[]>> => {
  const found = await tx.query<MembershipRow>(
    `SELECT m.user_id, m.role, w.id AS workspace_id, w.name AS workspace_name
       FROM member m JOIN workspace w ON w.id = m.workspace_id
      WHERE m.user_id = ANY($1::text[])
      ORDER BY w.name, w.id`,
    [personIds],
  );
  const held = new Map<string, readonly PersonMembership[]>();
  for (const row of found.rows) {
    const membership: PersonMembership = {
      workspace: { id: workspaceIdOf(row.workspace_id), name: row.workspace_name },
      role: boundarySchemas.member.select.shape.role.parse(row.role),
    };
    held.set(row.user_id, [...(held.get(row.user_id) ?? []), membership]);
  }
  return held;
};

type HeldBy = {
  readonly memberships: ReadonlyMap<string, readonly PersonMembership[]>;
  readonly signIns: ReadonlyMap<string, Date>;
};

const personOf = (row: PersonRow, held: HeldBy): PersonListed => ({
  id: boundarySchemas.user.select.shape.id.parse(row.id),
  displayName: row.name,
  email: row.email,
  memberships: held.memberships.get(row.id) ?? [],
  lastSignedInAt: isoOf(held.signIns.get(row.id) ?? null),
  credentialsRevokedAt: isoOf(row.credentials_revoked_at),
});

/**
 * Every person whose display name or address holds `search` as literal text, ignoring case, a page
 * at a time in name order, with each workspace they belong to and their role there. The last
 * sign-in is read from the identity-set audit log, so it outlives the person's sessions.
 */
export const listPeople = (
  operator: OperatorPrincipal,
  tx: Tx,
  input: ListPeopleInput,
): Promise<Result<PeoplePage, Error>> =>
  attempt(async () => {
    const pattern = containing(input.search.trim());
    const counted = await tx.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM ${MATCHING_PEOPLE}`,
      [pattern],
    );
    const page = await pageOf(tx, pattern, input);
    const ids = page.rows.map((row) => row.id);
    const held: HeldBy = {
      memberships: await membershipsOf(tx, ids),
      signIns: await latestOnIdentitySet(operator, tx, SIGN_IN_ACTS.signedIn, ids),
    };
    return {
      people: page.rows.map((row) => personOf(row, held)),
      total: counted.rows[0]?.total ?? 0,
    };
  });

export const inspectPersonInput = z.object({ personId: boundarySchemas.user.select.shape.id });

type InspectPersonInput = z.output<typeof inspectPersonInput>;

type SessionHeld = {
  readonly createdAt: string;
  /** Moved when the library extends the session, so it can trail a use by up to a day. */
  readonly lastUsedAt: string;
  readonly expiresAt: string;
};

type GrantHeld = {
  /** The client's id is the address of its metadata document. */
  readonly client: { readonly id: string; readonly name: string | null };
  readonly workspace: WorkspaceNamed | null;
  readonly issuedAt: string;
  /** When the client last refreshed; a call made on a live access token leaves no row. */
  readonly lastUsedAt: string;
  readonly expiresAt: string;
};

/** Marked when a session ends or at the client's own revocation: the row never says which. */
type EndedByTheServer = { readonly kind: "authorization-server" };

type EndedGrantInspected = GrantNamed & {
  readonly endedAt: string;
  /**
   * Everywhere is the operator's revocation; a workspace's is its Admin's revocation or removal;
   * a grant's is the authorization server ending that grant alone.
   */
  readonly scope: "everywhere" | "workspace" | "grant";
  readonly endedBy: AuditEventActor | EndedByTheServer;
};

type PersonInspected = {
  readonly sessions: readonly SessionHeld[];
  readonly grants: readonly GrantHeld[];
  /** Newest first: each act's, as its audit event recorded it, and each the server ended. */
  readonly ended: readonly EndedGrantInspected[];
};

type SessionRow = {
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly expires_at: Date;
};

type GrantRow = {
  readonly client_id: string;
  readonly client_name: string | null;
  readonly issued_at: Date;
  readonly last_used_at: Date;
  readonly expires_at: Date;
} & (
  | { readonly workspace_id: null; readonly workspace_name: null }
  | { readonly workspace_id: string; readonly workspace_name: string }
);

const SESSIONS_OF_PERSON = `SELECT created_at, updated_at, expires_at FROM session
                   WHERE user_id = $1 ORDER BY updated_at DESC, id DESC`;

/** Each authorisation's family of the person's refresh tokens, its unrotated row standing first. */
const FAMILIES_OF_PERSON = `SELECT r.client_id, c.name AS client_name, r.reference_id,
                                 w.id AS workspace_id, w.name AS workspace_name,
                                 min(r.created_at) OVER family AS issued_at,
                                 r.created_at AS last_used_at, r.expires_at, r.revoked,
                                 r.rotated_at,
                                 row_number() OVER (family ORDER BY r.rotated_at IS NULL DESC,
                                                    r.created_at DESC, r.id DESC) AS standing
                            FROM oauth_refresh_token r
                            JOIN oauth_client c ON c.client_id = r.client_id
                            LEFT JOIN workspace w ON w.id = r.reference_id
                           WHERE r.user_id = $1
                          WINDOW family AS (PARTITION BY COALESCE(r.authorization_code_id, r.id))`;

/** Each refresh revokes the row it rotates, so the unrotated row is the grant as it stands. */
const GRANTS_OF_PERSON = `SELECT client_id, client_name, workspace_id, workspace_name,
                       issued_at, last_used_at, expires_at
                  FROM (${FAMILIES_OF_PERSON}) grants
                 WHERE standing = 1 AND revoked IS NULL
                 ORDER BY last_used_at DESC, issued_at DESC`;

/** An unrotated row's mark ends its grant; once an act or a replay deletes the rows, it is gone. */
const ENDED_BY_THE_SERVER = `SELECT client_id, reference_id AS workspace_id, issued_at,
                                    revoked AS ended_at
                               FROM (${FAMILIES_OF_PERSON}) grants
                              WHERE standing = 1 AND revoked IS NOT NULL AND rotated_at IS NULL
                              ORDER BY revoked DESC, issued_at DESC`;

/** Both acts are the identity set's, so the read never enters a workspace's audit log. */
const ENDINGS_OF_PERSON = `SELECT id, act, at, actor, detail FROM identity_audit_event
                            WHERE subject_kind = 'person' AND subject_id = $1
                              AND act = ANY($2::text[])
                            ORDER BY at DESC, id DESC`;

const ENDING_ACT_NAMES = [REVOKED_EVERYWHERE.name, GRANTS_ENDED_HERE.name];

const sessionOf = (row: SessionRow): SessionHeld => ({
  createdAt: row.created_at.toISOString(),
  lastUsedAt: row.updated_at.toISOString(),
  expiresAt: row.expires_at.toISOString(),
});

const grantOf = (row: GrantRow): GrantHeld => ({
  client: { id: row.client_id, name: row.client_name },
  workspace:
    row.workspace_id === null
      ? null
      : { id: workspaceIdOf(row.workspace_id), name: row.workspace_name },
  issuedAt: row.issued_at.toISOString(),
  lastUsedAt: row.last_used_at.toISOString(),
  expiresAt: row.expires_at.toISOString(),
});

/** An event from before its act kept its grants reads none. */
const grantsRecorded = z.object({ grants: z.array(endedGrant).default([]) });

/** The identity-set audit event of an act that ended a person's grants, newest first. */
type Ending = {
  readonly act: string;
  readonly at: Date;
  readonly actor: string;
  readonly grants: z.output<typeof grantsRecorded>["grants"];
};

const endingEventsOf = async (tx: Tx, personId: UserId): Promise<readonly Ending[]> => {
  const found = await tx.query<Omit<Ending, "grants"> & { readonly detail: unknown }>(
    ENDINGS_OF_PERSON,
    [personId, ENDING_ACT_NAMES],
  );
  return found.rows.map(({ act, at, actor, detail }) => ({
    act,
    at,
    actor,
    grants: grantsRecorded.parse(detail).grants,
  }));
};

type Names = { readonly actors: ReadonlyMap<string, string>; readonly grants: GrantNames };

type EndedByTheServerRow = {
  readonly client_id: string;
  readonly workspace_id: WorkspaceId | null;
  readonly issued_at: Date;
  readonly ended_at: Date;
};

type ServerEnding = { readonly grant: EndedGrant; readonly at: Date };

const serverEndingsOf = async (tx: Tx, personId: UserId): Promise<readonly ServerEnding[]> => {
  const found = await tx.query<EndedByTheServerRow>(ENDED_BY_THE_SERVER, [personId]);
  return found.rows.map((row) => ({
    grant: {
      clientId: row.client_id,
      workspaceId: row.workspace_id,
      issuedAt: row.issued_at.toISOString(),
    },
    at: row.ended_at,
  }));
};

const grantEndedByTheServer = (ending: ServerEnding, names: Names): EndedGrantInspected => ({
  ...grantNamed(ending.grant, names.grants),
  endedAt: ending.at.toISOString(),
  scope: "grant",
  endedBy: { kind: "authorization-server" },
});

const grantsOfEnding = (ending: Ending, names: Names): readonly EndedGrantInspected[] =>
  ending.grants
    .toSorted((a, b) => b.issuedAt.localeCompare(a.issuedAt))
    .map((grant) => ({
      ...grantNamed(grant, names.grants),
      endedAt: ending.at.toISOString(),
      scope: ending.act === REVOKED_EVERYWHERE.name ? "everywhere" : "workspace",
      endedBy: actorOf(ending.actor, names.actors),
    }));

/**
 * No workspace's audit log is the operator's, so acts' endings come from the identity set's alone.
 * The stable sort keeps each act's own order.
 */
const endedGrantsOf = async (tx: Tx, personId: UserId): Promise<readonly EndedGrantInspected[]> => {
  const endings = await endingEventsOf(tx, personId);
  const byTheServer = await serverEndingsOf(tx, personId);
  const names = {
    actors: await namesOfActors(
      tx,
      endings.map((ending) => ending.actor),
    ),
    grants: await namesOfGrants(tx, [
      ...endings.flatMap((ending) => ending.grants),
      ...byTheServer.map((ending) => ending.grant),
    ]),
  };
  return [
    ...endings.flatMap((ending) => grantsOfEnding(ending, names)),
    ...byTheServer.map((ending) => grantEndedByTheServer(ending, names)),
  ].toSorted((a, b) => b.endedAt.localeCompare(a.endedAt));
};

/**
 * The person's sessions by last use, each client grant they hold, and each an act or the
 * authorization server ended. A grant is a refresh token's line: a client that asked for none
 * holds only an access token no row keeps, which lapses within the hour.
 */
export const inspectPerson = async (
  _operator: OperatorPrincipal,
  tx: Tx,
  input: InspectPersonInput,
): Promise<Result<PersonInspected, WorkspaceRefusal<"no-such-user"> | Error>> => {
  const inspected = await attempt(async () => {
    const person = await tx.query('SELECT 1 FROM "user" WHERE id = $1', [input.personId]);
    if (person.rowCount === 0) return undefined;
    const sessions = await tx.query<SessionRow>(SESSIONS_OF_PERSON, [input.personId]);
    const grants = await tx.query<GrantRow>(GRANTS_OF_PERSON, [input.personId]);
    return {
      sessions: sessions.rows.map(sessionOf),
      grants: grants.rows.map(grantOf),
      ended: await endedGrantsOf(tx, input.personId),
    };
  });
  if (!inspected.ok) return err(inspected.error);
  if (inspected.value === undefined) return err("no-such-user");
  return ok(inspected.value);
};
