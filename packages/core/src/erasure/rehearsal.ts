import { boundarySchemas } from "@better-answers/schema";

import { act, declareActs, record, type DetailOf } from "../audit/index.ts";
import { ERASURE_REHEARSAL_PATH, writeConcept } from "../concepts/index.ts";
import {
  attempt,
  err,
  ok,
  PERSON_PREFIX,
  ulid,
  type Clock,
  type Result,
  type UserPrincipal,
} from "../kernel/index.ts";
import { head, type GitDoor } from "../store/git/index.ts";
import type { ObjectDoor } from "../store/objects/index.ts";
import {
  withIdentityRead,
  withIdentityWrite,
  withPrincipal,
  withScope,
  type PostgresDoor,
} from "../store/postgres/index.ts";
import { recordSubjectRequest } from "./requests.ts";
import { runErasure, type ErasurePrincipal } from "./routine.ts";

const REHEARSAL_ACTS = declareActs("platform", {
  rehearsed: act("platform.erasure.rehearsed", {
    erasureRequestId: "id",
    subjectRequestId: "id",
    personId: "id",
    tokens: "count",
  }),
});

type RehearsedDetail = DetailOf<(typeof REHEARSAL_ACTS)["rehearsed"]["detail"]>;

export type RehearsalDoors = {
  readonly git: GitDoor;
  readonly postgres: PostgresDoor;
  readonly objects: ObjectDoor;
  readonly clock: Clock;
};

export type RehearsalRefusal = "malformed" | "not-seeded";

export type SyntheticSubject = {
  readonly personId: string;

  readonly email: string;

  readonly namedInFiles: string;
  readonly name: string;

  readonly tokens: readonly string[];
};

export type ErasureRehearsed = SyntheticSubject & {
  readonly subjectRequestId: string;
  readonly erasureRequestId: string;
  readonly completedAt: Date;

  readonly report: string;

  readonly auditEventId: string;
};

const SYNTHETIC_DOMAIN = "erasure-rehearsal.example.test";

const SYNTHETIC_ROLE = "Admin";

const CONCEPT_MERGE_KEY = "note:erasure-rehearsal";
const CONCEPT_TITLE = "Erasure rehearsal";

const CONCEPT_BODY =
  "The drill's synthetic note. It names the rehearsal's subject in the frontmatter's " +
  "`verified` entry and nowhere else, because that is the one form an erasure rewrites.";

const addressFor = (workspaceId: string): string =>
  `subject-${workspaceId.toLowerCase()}@${SYNTHETIC_DOMAIN}`;

const nameFor = (workspaceId: string): string => `Rehearsal subject ${workspaceId}`;

type RehearsalInput = { readonly workspaceId: string };

const workspaceNamed = (
  given: string,
): Result<{ readonly workspaceId: string; readonly email: string }, RehearsalRefusal> => {
  const workspace = boundarySchemas.workspace.select.shape.id.safeParse(given);
  if (!workspace.success) return err("malformed");
  return ok({ workspaceId: workspace.data, email: addressFor(workspace.data) });
};

const subjectOf = (workspaceId: string, personId: string): SyntheticSubject => {
  const email = addressFor(workspaceId);
  const namedInFiles = `${PERSON_PREFIX}${email}`;
  const name = nameFor(workspaceId);
  return { personId, email, namedInFiles, name, tokens: [email, namedInFiles, name] };
};

const personSeeded = async (
  platform: ErasurePrincipal,
  door: PostgresDoor,
  email: string,
  name: string,
): Promise<string | undefined> =>
  withIdentityWrite(platform, door, async (tx) => {
    await tx.query(
      `INSERT INTO "user" (id, name, email, email_verified) VALUES ($1, $2, $3, false)
       ON CONFLICT (email) DO NOTHING`,
      [ulid(), name, email],
    );
    const found = await tx.query<{ id: string }>(
      'SELECT id FROM "user" WHERE lower(email) = lower($1)',
      [email],
    );
    return found.rows[0]?.id;
  });

const membershipSeeded = (
  platform: ErasurePrincipal,
  door: PostgresDoor,
  workspaceId: string,
  personId: string,
): Promise<void> =>
  withScope(platform, door, workspaceId, async (tx) => {
    await tx.query(
      `INSERT INTO member (id, workspace_id, user_id, role, created_at)
         VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (workspace_id, user_id) DO NOTHING`,
      [ulid(), workspaceId, personId, SYNTHETIC_ROLE],
    );
  });

const principalOf = async (
  door: PostgresDoor,
  workspaceId: string,
  personId: string,
  at: Date,
): Promise<Result<UserPrincipal, Error>> => {
  const resolved = await withPrincipal(
    door,
    { workspaceId, userId: personId, issuedAt: at },
    async (principal) => principal,
  );
  return resolved.ok
    ? ok(resolved.value)
    : err(
        new Error(`erasure: the synthetic subject's principal did not resolve: ${resolved.error}`),
      );
};

const conceptSeeded = async (
  writer: UserPrincipal,
  doors: RehearsalDoors,
  subject: SyntheticSubject,
): Promise<Result<undefined, Error>> => {
  const at = doors.clock.now();
  const written = await writeConcept(
    writer,
    { git: doors.git, postgres: doors.postgres, clock: doors.clock },
    {
      mergeKey: CONCEPT_MERGE_KEY,
      path: ERASURE_REHEARSAL_PATH,
      kind: "Note",
      title: CONCEPT_TITLE,
      frontmatter: {
        title: CONCEPT_TITLE,
        type: "Note",
        verified: [{ by: subject.namedInFiles, at: at.toISOString() }],
      },
      body: CONCEPT_BODY,
      message: "Seed the erasure rehearsal's synthetic subject",
      author: { name: subject.name, email: subject.email },
      expects: { head: await head(writer, doors.git) },
      status: "stable",
    },
  );
  // A re-run meets its own seed as merge-key-taken; path-taken is another concept at the drill's
  // path, which no drill may run against.
  if (written.ok || written.error === "merge-key-taken") return ok(undefined);
  return err(new Error(`erasure: the rehearsal's concept was refused: ${String(written.error)}`));
};

/* jscpd:ignore-start */
export const seedSyntheticSubject = async (
  platform: ErasurePrincipal,
  doors: RehearsalDoors,
  input: RehearsalInput,
): Promise<Result<SyntheticSubject, RehearsalRefusal | Error>> => {
  const named = workspaceNamed(input.workspaceId);
  if (!named.ok) return err(named.error);
  const { workspaceId, email } = named.value;
  /* jscpd:ignore-end */

  const person = await attempt(() =>
    personSeeded(platform, doors.postgres, email, nameFor(workspaceId)),
  );
  if (!person.ok) return err(person.error);
  if (person.value === undefined) {
    return err(new Error("erasure: the rehearsal's person row was neither written nor found"));
  }
  const subject = subjectOf(workspaceId, person.value);

  const member = await attempt(() =>
    membershipSeeded(platform, doors.postgres, workspaceId, subject.personId),
  );
  if (!member.ok) return err(member.error);

  const writer = await principalOf(
    doors.postgres,
    workspaceId,
    subject.personId,
    doors.clock.now(),
  );
  if (!writer.ok) return err(writer.error);

  const concept = await conceptSeeded(writer.value, doors, subject);
  return concept.ok ? ok(subject) : err(concept.error);
};

const recordTheRehearsal = async (
  platform: ErasurePrincipal,
  door: PostgresDoor,
  workspaceId: string,
  detail: RehearsedDetail,
): Promise<string> => {
  const auditEventId = ulid();
  await withScope(platform, door, workspaceId, (tx) =>
    record(platform, tx, {
      id: auditEventId,
      act: REHEARSAL_ACTS.rehearsed,
      subjectId: detail.erasureRequestId,
      detail,
    }),
  );
  return auditEventId;
};

/* jscpd:ignore-start */
export const rehearseErasure = async (
  platform: ErasurePrincipal,
  doors: RehearsalDoors,
  input: RehearsalInput,
): Promise<Result<ErasureRehearsed, RehearsalRefusal | Error>> => {
  const named = workspaceNamed(input.workspaceId);
  if (!named.ok) return err(named.error);
  const { workspaceId, email } = named.value;
  /* jscpd:ignore-end */

  const person = await attempt(() =>
    withIdentityRead(platform, doors.postgres, async (tx) => {
      const found = await tx.query<{ id: string }>(
        'SELECT id FROM "user" WHERE lower(email) = lower($1)',
        [email],
      );
      return found.rows[0]?.id;
    }),
  );
  if (!person.ok) return err(person.error);
  if (person.value === undefined) return err("not-seeded");
  const subject = subjectOf(workspaceId, person.value);

  const at = doors.clock.now();
  const recorded = await withPrincipal(
    doors.postgres,
    { workspaceId, userId: subject.personId, issuedAt: at },
    (admin, tx) =>
      recordSubjectRequest(admin, tx, {
        kind: "erasure",
        identifiers: { emails: [subject.email], names: [subject.name], other: [] },
        personId: subject.personId,
        receivedAt: at,
        clockStartedAt: at,
      }),
  );
  if (!recorded.ok) {
    return err(
      new Error(`erasure: the rehearsal's request was refused: ${String(recorded.error)}`),
    );
  }
  const subjectRequestId = recorded.value.requestId;

  const run = await runErasure(platform, doors, { workspaceId, subjectRequestId });
  if (!run.ok) {
    return err(new Error(`erasure: the rehearsal's routine refused: ${String(run.error)}`));
  }

  const event = await attempt(() =>
    recordTheRehearsal(platform, doors.postgres, workspaceId, {
      erasureRequestId: run.value.erasureRequestId,
      subjectRequestId,
      personId: subject.personId,
      tokens: subject.tokens.length,
    }),
  );
  if (!event.ok) return err(event.error);

  return ok({
    ...subject,
    subjectRequestId,
    erasureRequestId: run.value.erasureRequestId,
    completedAt: run.value.completedAt,
    report: run.value.report,
    auditEventId: event.value,
  });
};
