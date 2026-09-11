import { boundarySchemas } from "@better-answers/schema";

import { actorIdOfPerson, type ActorId, type PlatformPrincipal } from "../kernel/index.ts";
import { historyNaming, type GitDoor } from "../store/git/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import type { SubjectRequest } from "./requests.ts";

/**
 * The **erasure map** (`CONTEXT.md`; ADR 0020; the S0 spec, the routine's step 2): one finder
 * per store family over an exhaustive union, answering **where** the platform holds a person
 * and **under which categories** — never a passage's text, so a reply under Article 15 carries
 * no third party's data.
 *
 * **One declared descriptor per family.** The registry's key is the family's word, its value
 * the categories of personal data that family holds and the finder that reads it, and it is
 * written `satisfies Record<ErasureFamily, ErasureFamilyDescriptor>` over the tuple below —
 * so a store family added to the union without a finder does not compile. That is the whole
 * guard the spec asks for: a store the routine never searched would be an erasure that
 * quietly missed one, and nobody would see it.
 *
 * **Under the platform principal, in one workspace's scope.** The map is the routine's step 2
 * and the identity arms read rows no workspace Admin should be handed across tenants (ADR
 * 0035's rejected oracle), so `erasureMapOf` takes a `PlatformPrincipal` and a `Tx` already
 * scoped to the request's workspace (`withScope`). Every arm is fenced to that workspace: the
 * two record families by their own `workspace_id` under row-level security, and the identity
 * set — which row-level security does not reach — through the membership this workspace
 * holds. An Admin's road to the same facts is the access answer over a map the platform
 * computed, never this function.
 *
 * **The two forms a person is named by.** A concept file carries `human:<email>` in
 * `generated.by` and `verified[].by` and a commit's author line carries the address itself
 * (ADR 0019), while `bundle_commit.actor` and `concept_verification.actor` carry
 * `human:<person id>` (ADR 0035). The difference is by decision — it is why the routine
 * rewrites files and never the ledger — so the arms do not share a needle.
 */

/**
 * Every store family that holds text about a person, in the order the map walks them. The
 * tuple is the union, so the word is written once and the registry below is held to it.
 *
 * `concept-file` is **one** family for the files at the bundle's head and the history behind
 * them: the spec writes "concept files and their history" as one phrase and the routine's git
 * step rewrites both in one pass, so the map carries one entry whose locations name paths at
 * a commit and commits whose author line names the person.
 */
export const ERASURE_FAMILIES = [
  "concept-file",
  "bundle-commit",
  "concept-verification",
  "identity-user",
  "identity-session",
  "identity-verification",
  "identity-invitation",
  "identity-account",
  "source-document",
] as const;

export type ErasureFamily = (typeof ERASURE_FAMILIES)[number];

/**
 * The categories of personal data a family may hold — the words the access answer reads back
 * as *under which categories* (`CONTEXT.md`, *subject request*). They describe the platform's
 * own records rather than a document's contents: what a finding is categorised by is the
 * redaction seam's list and a different question entirely.
 */
const PERSONAL_DATA_CATEGORIES = [
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

/**
 * The subject as every finder takes them, resolved once against this workspace before any arm
 * runs — so no arm decides for itself who the person is, and the workspace fence is read in
 * one place rather than nine.
 */
type SubjectHere = {
  readonly workspaceId: string;
  /** Every email the identifier set names, lowered: the one form the arms match on. */
  readonly emails: readonly string[];
  /** `human:<person id>` where the request names a person — what the two record families carry. */
  readonly actor: ActorId | null;
  /** The person **this workspace** knows; `null` for a subject this workspace holds no membership for. */
  readonly memberId: string | null;
  /** What the bundle's history is read for: a file's `human:<email>` and an author's address. */
  readonly needles: readonly string[];
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

/**
 * One family's answer: what in it names the person, as words a reader can act on — a row's
 * key, a commit and a path. Never a value read out of the thing the location names.
 */
type ErasureMapEntry = {
  readonly family: ErasureFamily;
  readonly categories: readonly PersonalDataCategory[];
  readonly locations: readonly string[];
};

export type ErasureMap = readonly ErasureMapEntry[];

/**
 * One read, one column. Every arm names its own statement and selects `location`, so the shape
 * of a store read lives here once rather than once per family — nine near-identical reads
 * would be nine places to change the day a location gains a word.
 */
const located = async (
  tx: Tx,
  statement: string,
  parameters: readonly unknown[],
): Promise<readonly string[]> => {
  const found = await tx.query<{ location: string }>(statement, [...parameters]);
  return found.rows.map((row) => row.location);
};

/**
 * A read of the workspace's **own** records, which carry a `workspace_id` and sit under
 * row-level security: `$1` is the workspace and `$2` the actor id the platform wrote. A
 * request that names no person names no actor, and the statement is never run for one.
 */
const aboutTheActor = async (
  tx: Tx,
  subject: SubjectHere,
  statement: string,
): Promise<readonly string[]> =>
  subject.actor === null ? [] : located(tx, statement, [subject.workspaceId, subject.actor]);

/**
 * A read of the **identity set**, which row-level security does not reach — so the fence is
 * the membership this workspace holds, resolved once and passed as `$1`, with a statement's
 * own parameters after it. No membership here is no identity set here, which is what keeps a
 * map computed in one workspace off another workspace's person.
 */
const aboutTheMember = async (
  tx: Tx,
  subject: SubjectHere,
  statement: string,
  extras: readonly unknown[] = [],
): Promise<readonly string[]> =>
  subject.memberId === null ? [] : located(tx, statement, [subject.memberId, ...extras]);

/**
 * The person this workspace's membership knows, by the person id where the request has one
 * and by the emails where it does not. The one read that turns a subject into a member, so
 * every identity arm below is fenced by the same sentence.
 */
const MEMBER_HERE = `SELECT u.id AS location
     FROM "user" u
     JOIN member m ON m.user_id = u.id
    WHERE m.workspace_id = $1 AND (u.id = $2 OR lower(u.email) = ANY($3))
    LIMIT 1`;

const ERASURE_FAMILY_DESCRIPTORS = {
  /**
   * The bundle: the files at its head and every commit behind them, read through the git
   * door's one history read. A blob's location is `<commit>:<path>`, which is what
   * `git show` takes; an author line's is the commit and the words that say so.
   */
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

  /** The ledger of governed writes: the commit this person's act made, by its sha. */
  "bundle-commit": {
    categories: ["actor-id"],
    find: (platform, subject, tx) =>
      aboutTheActor(
        tx,
        subject,
        "SELECT sha AS location FROM bundle_commit WHERE workspace_id = $1 AND actor = $2",
      ),
  },

  /** Every check this person made, which the routine re-hashes rather than deletes (story 13). */
  "concept-verification": {
    categories: ["actor-id"],
    find: (platform, subject, tx) =>
      aboutTheActor(
        tx,
        subject,
        "SELECT id AS location FROM concept_verification WHERE workspace_id = $1 AND actor = $2",
      ),
  },

  /** The user row itself — the name and the address the routine pseudonymises on a last membership. */
  "identity-user": {
    categories: ["name", "email-address"],
    find: (platform, subject, tx) =>
      aboutTheMember(tx, subject, `SELECT id AS location FROM "user" WHERE id = $1`),
  },

  /** Sign-ins, each with the address it came from and the agent that made it. */
  "identity-session": {
    categories: ["sign-in", "ip-address", "device"],
    find: (platform, subject, tx) =>
      aboutTheMember(tx, subject, "SELECT id AS location FROM session WHERE user_id = $1"),
  },

  /**
   * Verification codes, which are keyed by identifier rather than by person: the subject's own
   * emails and the address the user row carries, because a code was sent to one of the two.
   */
  "identity-verification": {
    categories: ["email-address"],
    find: (platform, subject, tx) =>
      aboutTheMember(
        tx,
        subject,
        `SELECT id AS location FROM verification
          WHERE lower(identifier) = ANY($2)
             OR lower(identifier) = (SELECT lower(email) FROM "user" WHERE id = $1)`,
        [subject.emails],
      ),
  },

  /** Invitations, by the address they were sent to, inside this workspace and no other. */
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

  /** Linked accounts: the external identity a sign-in came through. */
  "identity-account": {
    categories: ["linked-account"],
    find: (platform, subject, tx) =>
      aboutTheMember(tx, subject, "SELECT id AS location FROM account WHERE user_id = $1"),
  },

  /**
   * Documents that mention the person, matched over the normalised text. **Declared, and its
   * finder answers none until S1**: no document, no binding and no normalised text exists yet,
   * and a family left out of the union until its store lands would be a store the routine
   * never learned to search. The map says *nothing here* rather than staying silent.
   */
  "source-document": {
    categories: ["document-text"],
    find: () => Promise.resolve([]),
  },
} satisfies Record<ErasureFamily, ErasureFamilyDescriptor>;

/**
 * The map for one subject request: one entry per family, in the union's order, each naming
 * what in that family names the person.
 *
 * **An empty family is an entry, never an absence.** For a subject with no user row the git
 * and identity arms find nothing, and the map has to say so — a reader of the access answer
 * must be able to tell a store that holds nothing about the person from a store nobody asked.
 *
 * The arms run one after another on the one scoped transaction they were handed, because they
 * share it: the map is a read inside the routine's own transaction, not nine of its own.
 */
export const erasureMapOf = async (
  platform: PlatformPrincipal,
  tx: Tx,
  door: GitDoor,
  request: SubjectRequest,
): Promise<ErasureMap> => {
  const emails = (request.identifiers?.emails ?? []).map((email) => email.trim().toLowerCase());
  // Parsed at the boundary rather than asserted (ADR 0028): the column is a foreign key to a
  // person the platform minted, so a value of another shape is a broken database and the
  // throw is the truthful answer to it.
  const personId =
    request.personId === null ? null : boundarySchemas.user.select.shape.id.parse(request.personId);
  const [memberId = null] = await located(tx, MEMBER_HERE, [request.workspaceId, personId, emails]);
  const subject: SubjectHere = {
    workspaceId: request.workspaceId,
    emails,
    actor: personId === null ? null : actorIdOfPerson(personId),
    memberId,
    // The emails, and the person id where the subject has one: the history finder matches
    // both (the S0 spec, step 2), and a file that carried the id would be found with them.
    needles: personId === null ? emails : [...emails, personId],
  };

  const entries: ErasureMapEntry[] = [];
  for (const family of ERASURE_FAMILIES) {
    const descriptor = ERASURE_FAMILY_DESCRIPTORS[family];
    const found = await descriptor.find(platform, subject, tx, door);
    // Sorted, so one workspace's map reads the same on every run whatever order a store
    // answered in — a report and an access answer are documents a person is given.
    entries.push({ family, categories: descriptor.categories, locations: [...found].sort() });
  }
  return entries;
};

/** One place the platform holds the person, and the categories of personal data it holds there. */
type AccessAnswerLocation = {
  readonly family: ErasureFamily;
  readonly categories: readonly PersonalDataCategory[];
  readonly location: string;
};

/**
 * The **access answer** (`CONTEXT.md`, *subject request*; the S0 spec's `subject_request`
 * paragraph): where the platform holds the person, and under which categories. Both lists, and
 * nothing else — a reply under Article 15 is written from this, and a passage's text would be a
 * third party's data in a document a person is given.
 */
export type AccessAnswer = {
  /**
   * Every category the platform holds about this person, in the order the categories are
   * declared — so the answer reads the same however the families were walked, and a category no
   * location evidences is not one the platform tells the person it holds.
   */
  readonly categories: readonly PersonalDataCategory[];
  readonly locations: readonly AccessAnswerLocation[];
};

/**
 * The map read as the answer. **Pure**: a function of the map and nothing else — no principal,
 * no transaction, no door — because the facts were found under the platform principal in one
 * workspace's scope and this only reads them back. An Admin reaches them here and never through
 * `erasureMapOf`.
 *
 * **A family that named nothing is not a place.** The map answers every family, empty ones
 * included, because the routine has to see that each store was searched; the answer is a reply
 * to a person, where a store holding nothing about them is not somewhere they are held. So the
 * empty families fall away and a subject the platform holds nothing about is told exactly that.
 */
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
