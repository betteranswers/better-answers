import { boundarySchemas } from "@better-answers/schema";

import { act, declareActs, record, type DetailOf } from "../audit/index.ts";
import { writeConcept } from "../concepts/index.ts";
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

/**
 * **The erasure rehearsal** (ADR 0020, ADR 0022; the S0 spec, *The two ops commands*): the
 * drill's proof, run every third month against staging, that an erasure removes what it says it
 * removes — `pnpm ops erasure-rehearsal --seed` and `--run`, whose core half this is.
 *
 * A backup that restores is not the same claim as an erasure that erased. The drill can only
 * make the second claim by doing it: seed a person into staging, take a dump, run the real
 * routine over them, take a second dump, and grep both for the values that person is
 * recognisable by. The first grep has to find them or the second proves nothing.
 *
 * **Two phases, because the dump goes between them.** Everything the second phase needs it
 * reads back out of the rows. That is not a convenience: a drill dumps, wipes and restores
 * between the phases, and a second phase handed an id the first phase returned would be a
 * rehearsal of a process nobody runs. The join between them is the **synthetic address**, which
 * this module derives from the workspace id alone — one workspace has one synthetic subject,
 * anybody holding the workspace id can name them, and neither phase has to remember anything.
 *
 * **Everything about the subject is obviously synthetic**, because this runs against staging
 * and staging holds synthetic data only (ADR 0024). The address sits under a reserved domain
 * that can never resolve and carries the workspace id, and the display name says in words what
 * it is. A fixture that invented a plausible person would be the one thing staging must never
 * hold, which is `deploy/seed-synthetic.sh`'s own sentence.
 *
 * **The report is the routine's, not this module's.** `rehearseErasure` runs `runErasure` and
 * hands back what it wrote. A document built here *in the shape of* a report would be a
 * rehearsal of a formatter; the point of the exercise is that an operator reads the same words
 * a data subject would.
 *
 * **What a token is, and what it is not.** The tokens are the values a dump is grepped for, and
 * each of them is a value the erasure actually removes: the address, which step 5 replaces with
 * a tombstone and the git step mailmaps off every author line; the `human:<address>` form a
 * concept file names a person by (ADR 0019), which the git step rewrites to the erasure
 * pseudonym; and the display name, which step 5 clears and the same mailmap takes with the
 * address. A postal address or a phone number in a concept **body** would not be one: the git
 * step rewrites actor identifiers and nothing else, so a token the routine cannot remove would
 * be a drill that failed for being right. The one place a token legitimately survives is the
 * subject request's own identifier set, which is the record of the request and is restricted
 * personal data by design (the S0 spec, `subject_request`).
 *
 * The word *token* is `dump-grep --tokens`', which is the command the drill hands these to; it
 * is never a credential (`CONTEXT.md`, *personal token*, *agent token*).
 */

/**
 * The rehearsal's own act. Its subject is the erasure request, as the replay's is, so the
 * ledger answers "what happened to this erasure" by subject however the routine was reached.
 * The detail is three ids and **how many tokens there were** — never a token. The constitution
 * holds a detail to ids and role words and refuses it an email, a display name, a prompt or a
 * completion, because the ledger is never rewritten; a detail that carried a token would be the
 * one record of this person an erasure had just promised to remove (ADR 0035).
 *
 * Declared here rather than beside `platform.erasure.replayed`: a rehearsal is not a replay,
 * and the tree already holds several `platform` declarations, one per module that acts.
 */
const REHEARSAL_ACTS = declareActs("platform", {
  rehearsed: act("platform.erasure.rehearsed", {
    erasureRequestId: "id",
    subjectRequestId: "id",
    personId: "id",
    tokens: "count",
  }),
});

type RehearsedDetail = DetailOf<(typeof REHEARSAL_ACTS)["rehearsed"]["detail"]>;

/**
 * The doors a rehearsal takes: the four the routine takes, because running the routine is what
 * the second phase is. The first phase reaches three of them — the seed writes rows and one
 * commit and touches no object.
 */
export type RehearsalDoors = {
  readonly git: GitDoor;
  readonly postgres: PostgresDoor;
  readonly objects: ObjectDoor;
  readonly clock: Clock;
};

/** Why a rehearsal would not run. Anything else is the store's own `Error`. */
export type RehearsalRefusal =
  /** The workspace id is not one this platform ever minted. */
  | "malformed"
  /** No synthetic subject stands in this workspace: the seed has not run, or has been erased. */
  | "not-seeded";

/** The synthetic subject of one workspace's rehearsal — who they are and how to look for them. */
export type SyntheticSubject = {
  /** The person id the seed minted, which the erasure keeps because ledger rows name it. */
  readonly personId: string;
  /** The address on the `user` row, and the one the identifier set names. */
  readonly email: string;
  /** How a **file** names them — `human:<address>` (ADR 0019) — which the git step rewrites. */
  readonly namedInFiles: string;
  readonly name: string;
  /** The three above in a fixed order: what `dump-grep --tokens` is handed, comma by comma. */
  readonly tokens: readonly string[];
};

/** What one rehearsal comes to: the subject, the routine's own report, and the ids behind it. */
export type ErasureRehearsed = SyntheticSubject & {
  readonly subjectRequestId: string;
  readonly erasureRequestId: string;
  readonly completedAt: Date;
  /** The routine's report, word for word — this module writes no document of its own. */
  readonly report: string;
  /** This rehearsal's own ledger row, so a caller can name the event it wrote. */
  readonly auditEventId: string;
};

/**
 * The reserved domain every synthetic address sits under. `.test` is reserved for exactly this
 * (RFC 2606) and resolves nowhere, and the label in front of it says what the address is for,
 * so an operator reading a staging dump can tell a drill's subject from a client's at a glance.
 */
const SYNTHETIC_DOMAIN = "erasure-rehearsal.example.test";

/** The role the subject holds: they record their own request, and an Admin is who may. */
const SYNTHETIC_ROLE = "Admin";

const CONCEPT_PATH = "knowledge/erasure-rehearsal.md";
const CONCEPT_MERGE_KEY = "note:erasure-rehearsal";
const CONCEPT_TITLE = "Erasure rehearsal";

/**
 * The note's body names nobody. The subject is in `verified[].by` and nowhere else, because
 * `verified` is the key ADR 0019 keeps out of the content hash and the git step's one rewrite
 * is over the `human:<address>` form — a name written into prose here would be a token the
 * routine leaves standing, and the drill's second grep would fail for a reason that is not a
 * defect in erasure.
 */
const CONCEPT_BODY =
  "The drill's synthetic note. It names the rehearsal's subject in the frontmatter's " +
  "`verified` entry and nowhere else, because that is the one form an erasure rewrites.";

/** A workspace's synthetic address: derived, never stored, which is what joins the two phases. */
const addressFor = (workspaceId: string): string =>
  `subject-${workspaceId.toLowerCase()}@${SYNTHETIC_DOMAIN}`;

/** The display name, carrying the workspace id for the same reason the address does. */
const nameFor = (workspaceId: string): string => `Rehearsal subject ${workspaceId}`;

/**
 * What each phase is given, and all it is given. The drill calls the two hours apart with a
 * dump, a wipe and a restore in between, so the second can be handed nothing the first knew;
 * one input type is that promise written down where a caller reads it.
 */
type RehearsalInput = { readonly workspaceId: string };

/**
 * The one thing both phases are handed, read once: the workspace id parsed at the boundary
 * rather than asserted (ADR 0028), and the address that workspace's synthetic subject always
 * has. Both begin here because the derivation is the whole of what joins them — a dump goes
 * between the two, and a name neither phase stores is the only kind that survives one.
 *
 * That both phases then open with the same four lines is the point rather than a copy, so the
 * two openings are fenced from the copy gate below and this is the reason: they are one
 * contract said twice, the way `withIdentityWrite` and `withIdentityRead` are in the Postgres
 * door. There is nothing left in them to fold — the shared work is already this function.
 */
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

/**
 * The person row, minted once and read back by address.
 *
 * `ON CONFLICT DO NOTHING` and then a read, rather than `RETURNING`, because the answer this
 * needs is *the synthetic subject of this workspace* and not *the row this statement wrote*:
 * on a second seed there is no row to return and the subject is the one already standing. The
 * identity set carries no `workspace_id` and no policy, so it is reached through the door's
 * unscoped seam (ADR 0009; ADR 0029's amendment) and never through a workspace scope.
 */
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

/**
 * The membership, in this workspace's scope because `member` is a tenant table. Its key is
 * minted rather than composed, which is `provisionWorkspace`'s own decision said again; the
 * unique pair is what makes a second seed change nothing.
 */
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

/** The subject's own Principal, resolved off the membership just written, as any transport would. */
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

/**
 * The one concept file, written through the governed write so the bundle, the rows and the
 * ledger say the same thing a real edit would — the rehearsal is worth nothing if what it
 * erases is not shaped like what the platform actually holds.
 *
 * A second seed finds the path and the merge key taken, which is the file already standing and
 * not a failure: those two refusals are the idempotence, and every other one is returned.
 */
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
      path: CONCEPT_PATH,
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
  if (written.ok || written.error === "path-taken" || written.error === "merge-key-taken") {
    return ok(undefined);
  }
  return err(new Error(`erasure: the rehearsal's concept was refused: ${String(written.error)}`));
};

/**
 * **Phase one: put a synthetic subject in this workspace and say what to grep for.**
 *
 * A person with an address, a membership that makes them an Admin of it, and one concept file
 * naming them — the three places a member of a real workspace is held that an erasure has to
 * reach. It answers with the tokens, which is the only thing the drill carries forward: the
 * ids below are for the operator's report, and phase two reads its own.
 *
 * Idempotent the way `deploy/seed-synthetic.sh` is: a second seed of the same workspace finds
 * the same address, the same membership and the same path, and is the same subject rather than
 * a second one.
 */
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

/** The rehearsal's ledger row, in the workspace the drill named, bare (ADR 0014 rule 4). */
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

/**
 * **Phase two: record the request, run the routine, and answer with what it wrote.**
 *
 * It takes the workspace id and nothing else, which is the whole of what makes the two phases
 * separable: the subject is found by the address this workspace's synthetic subject always has,
 * read out of the `user` row the seed left behind. A dump, a wipe and a restore between the
 * phases change nothing, because nothing was carried across them.
 *
 * A workspace with no such row is **refused** rather than run: the alternative is a rehearsal
 * that erased whoever else happened to be there.
 *
 * The request is recorded as the subject's own Principal, so a drill never books an act to a
 * real person; the routine then runs under the platform's own, as it does everywhere.
 */
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
    return err(new Error(`erasure: the rehearsal's principal was refused: ${recorded.error}`));
  }
  if (!recorded.value.ok) {
    return err(new Error(`erasure: the rehearsal's request was refused: ${recorded.value.error}`));
  }
  const subjectRequestId = recorded.value.value.requestId;

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
