import { boundarySchemas } from "@better-answers/schema";
import { z } from "zod";

import { attempt, err, ok, type PlatformPrincipal, type Result } from "../kernel/index.ts";
import {
  getPlatformObject,
  listPlatformObjects,
  putPlatformObject,
  type ObjectDoor,
} from "../store/objects/index.ts";
import { ERASURE_FAMILIES, PERSONAL_DATA_CATEGORIES, type ErasureMap } from "./map.ts";
import type { SubjectIdentifiers } from "./requests.ts";

/**
 * The **replay copy** (`CONTEXT.md`; ADR 0020; ADR 0022; the S0 spec, step 10): the completed
 * erasure request, written to the object store under the platform's own prefix, that a restore
 * reads to run the erasure again over a dump older than the request.
 *
 * It exists for one restore in particular. A dump taken **after** a request completed carries
 * the `erasure_request` row and the suppressions with it, and the replay finds the request in
 * the restored table. A dump taken **before** it carries neither — the person's data is back,
 * the record that it was erased is not, and without this copy nothing in the estate knows an
 * erasure is owed. So the copy goes to the store the dump is not part of, is mirrored nightly
 * and is synced back before `api` is allowed to turn healthy (ADR 0022).
 *
 * **What it carries is what a re-run needs and nothing else about the person.** The workspace
 * and the two ids to find and de-duplicate the request; the person id where the subject holds
 * a login and no key at all where they hold none; the erasure pseudonym, so a replay rewrites
 * the restored history to the id the first run used rather than minting a second one for one
 * person; the completion, so `replay-erasures --since` can tell the requests it must run from
 * the ones already behind it; the identifier set, because the suppressions were written from
 * it and a restored database older than the request holds no `subject_request` row to read it
 * off; and the erasure map, as the record of where the person was found.
 *
 * **It is written before the completion commits**, on the one clock reading step 11 stamps the
 * row with, so the copy and the row never disagree about when the erasure happened. A copy
 * standing without its row is a re-run's input and nothing else, and the routine it feeds is
 * idempotent by construction; a row standing without its copy loses the erasure to a restore
 * from a dump older than the request, which is the failure this copy exists to prevent. The
 * order is the routine's, and `routine.ts`'s step 10 gives the reasoning in full.
 *
 * **It is not the report's twin, and the difference is deliberate.** `erasureReportOf` is
 * starved of the identifier set and of the pseudonym: it is a document handed to a person, so
 * it may not print an address it was never given, and a report naming the pseudonym would be
 * the cross-workspace join ADR 0035 exists to prevent. This copy is the input to a routine
 * rather than a document, nobody is handed it, and both values are exactly what it is for. It
 * is therefore **restricted personal data of the same class as the `suppression` table**, kept
 * under the platform prefix that no workspace principal can address, and the report's
 * beyond-use dates cover it as they cover every dump.
 *
 * **Both halves live here**: the write the routine's step 10 makes, and the read a restore makes
 * on the other side of it. One module, because the document's shape is one fact — a reader that
 * stated it a second time would be a second thing to keep in step with the writer, and the one
 * moment the two must agree is the moment when nothing else in the estate knows an erasure is
 * owed. What the replay then *does* with a copy is `replay-erasures.ts`.
 */

/**
 * The prefix every copy lives under **inside** the platform's own, so a replay scans one
 * listing and the platform's prefix stays open to whatever else the estate later keeps there.
 */
const REPLAY_PREFIX = "erasures/";

/**
 * Where one request's copy lives: by workspace, then by erasure request, which is the pair the
 * `erasure_request` table is keyed by. A second run of the same request derives the same key
 * and overwrites it, so the store holds one copy per request rather than one per run.
 */
export const replayCopyKeyOf = (workspaceId: string, erasureRequestId: string): string =>
  `${REPLAY_PREFIX}${workspaceId}/${erasureRequestId}.json`;

/** The copy as the object store holds it, and as `replay-erasures` reads it back. */
export type ReplayCopy = {
  readonly workspaceId: string;
  readonly subjectRequestId: string;
  readonly erasureRequestId: string;
  /** The person where the subject holds a login; **absent** where they hold none (ADR 0035). */
  readonly personId?: string;
  /** What `human:<address>` became across this workspace's history. */
  readonly pseudonym: string;
  /** The instant the request stands completed at, in ISO-8601 — what `--since` is read against. */
  readonly completedAt: string;
  /** The set the suppressions were written from; the JSON null for a set that names nobody. */
  readonly identifiers: SubjectIdentifiers | null;
  readonly map: ErasureMap;
};

/** One run of bytes, as the door's put takes a body. */
const streamOf = (bytes: Uint8Array): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start: (controller) => {
      controller.enqueue(bytes);
      controller.close();
    },
  });

/**
 * Write one request's copy, overwriting the copy that request already has.
 *
 * The key is derived from two ids the platform minted, so the door's refusal of a key that
 * names nothing is unreachable here and is a throw rather than a refusal a caller must handle
 * — as an `erasure_request` row that does not read back after its own insert is.
 *
 * The document is indented, because the one hand that ever opens it directly is an engineer's
 * during a restore, and the cost of the whitespace is a few bytes per erasure.
 */
export const writeReplayCopy = async (
  platform: PlatformPrincipal,
  door: ObjectDoor,
  completed: {
    readonly workspaceId: string;
    readonly subjectRequestId: string;
    readonly erasureRequestId: string;
    readonly personId: string | null;
    readonly pseudonym: string;
    readonly completedAt: Date;
    readonly identifiers: SubjectIdentifiers | null;
    readonly map: ErasureMap;
  },
): Promise<void> => {
  const named = {
    workspaceId: completed.workspaceId,
    subjectRequestId: completed.subjectRequestId,
    erasureRequestId: completed.erasureRequestId,
    pseudonym: completed.pseudonym,
    completedAt: completed.completedAt.toISOString(),
    identifiers: completed.identifiers,
    map: completed.map,
  };
  // The person id where the subject holds a login, and the key left out where they hold none
  // — an absent optional, never a null standing in for a person, which is the shape the
  // completion's own audit detail takes for the same reason.
  const copy: ReplayCopy =
    completed.personId === null ? named : { ...named, personId: completed.personId };

  const written = await putPlatformObject(
    platform,
    door,
    replayCopyKeyOf(completed.workspaceId, completed.erasureRequestId),
    streamOf(new TextEncoder().encode(JSON.stringify(copy, null, 2))),
  );
  if (!written.ok) {
    throw new Error(`erasure: the replay copy's key was refused (${written.error})`);
  }
};

/**
 * The copy as a restore reads it back — **parsed, never cast** (ADR 0028). These bytes have been
 * out of the platform's hands: written months ago by a version that is not this one, mirrored to
 * a second bucket, and synced back onto a machine that has just been rebuilt. A cast would make
 * the first sign of a copy that is not one an error deep inside the routine, on a subject
 * request id that is really a null.
 *
 * Every field is held to the shape the column it came from is held to, read off the boundary
 * rather than restated, so the copy and the rows it re-creates cannot drift apart: the two ids
 * and the pseudonym are the minter's, the person id is a person id, and the identifier set is
 * the same bounded three-list shape the `subject_request` column carries. The map is held to the
 * erasure map's own vocabulary, which is why `map.ts` exports its category list.
 *
 * **Unknown keys are dropped rather than refused.** A restore is where forgiveness is worth
 * something: a copy carrying a field this version has never heard of is still a copy of an
 * erasure that is owed, and refusing it would leave that erasure un-replayed over a field
 * nothing here reads. A field this version *needs* and the copy lacks is refused, which is the
 * direction that matters.
 */
const COPY_AS_READ = z.object({
  workspaceId: boundarySchemas.workspace.select.shape.id,
  subjectRequestId: boundarySchemas.subjectRequest.select.shape.id,
  erasureRequestId: boundarySchemas.erasureRequest.select.shape.id,
  // The person's own id where the subject holds a login: `user.id`'s shape, because that is the
  // row `subject_request.person_id` points at. Optional and never nullable — the writer leaves
  // the key out for a subject who never signed in, and a `null` here would be a copy no writer
  // of ours produced.
  personId: boundarySchemas.user.select.shape.id.optional(),
  pseudonym: boundarySchemas.erasureRequest.select.shape.pseudonym,
  completedAt: z.iso.datetime(),
  identifiers: boundarySchemas.subjectRequest.select.shape.identifiers,
  map: z.array(
    z.object({
      family: z.enum(ERASURE_FAMILIES),
      categories: z.array(z.enum(PERSONAL_DATA_CATEGORIES)),
      locations: z.array(z.string()),
    }),
  ),
});

/**
 * The document at one key, as the type the rest of the slice reads.
 *
 * The person id is put back the way the writer took it off — present or absent, never a `null`
 * standing in for a person — because that is the distinction every caller downstream reads to
 * decide whether a re-created request names somebody or names nobody.
 */
const copyOf = (parsed: z.infer<typeof COPY_AS_READ>): ReplayCopy => {
  const named = {
    workspaceId: parsed.workspaceId,
    subjectRequestId: parsed.subjectRequestId,
    erasureRequestId: parsed.erasureRequestId,
    pseudonym: parsed.pseudonym,
    completedAt: parsed.completedAt,
    identifiers: parsed.identifiers,
    map: parsed.map,
  };
  return parsed.personId === undefined ? named : { ...named, personId: parsed.personId };
};

/**
 * One copy, read and parsed, or a throw naming the key — which is what an operator can act on.
 *
 * The door hands bytes back as a stream and the runtime's own `Response` is what turns one into
 * text: it decodes UTF-8 across chunk boundaries, which is the one thing a hand-rolled read gets
 * wrong, and an identifier set is exactly where a person's name arrives with an accent in it.
 */
const copyAt = async (
  platform: PlatformPrincipal,
  door: ObjectDoor,
  key: string,
): Promise<ReplayCopy> => {
  const got = await getPlatformObject(platform, door, key);
  if (!got.ok)
    throw new Error(`erasure: the replay copy at ${key} was not readable (${got.error})`);
  const parsed = COPY_AS_READ.safeParse(JSON.parse(await new Response(got.value).text()));
  if (!parsed.success) {
    throw new Error(`erasure: the replay copy at ${key} is not a replay copy`, {
      cause: parsed.error,
    });
  }
  return copyOf(parsed.data);
};

/**
 * **Every copy in the store for an erasure that completed after `since`**, across every
 * workspace — the first half of what `replay-erasures` has to run, and the half that survives a
 * dump taken before the request.
 *
 * **A store that will not answer is an error, and never an empty set.** This is the whole
 * reason the function returns a `Result` at all: an estate whose copies are unreachable knows
 * nothing about the erasures it owes, and *none* is the one answer it must not give — a restore
 * would read it as "there was nothing to replay", let `api` turn healthy, and put a person's
 * data back where an erasure took it from. The caller turns this error into a refusal that
 * stops the restore (ADR 0022). The same goes for a key the listing named and the get could
 * not read, and for a document that is not a copy: each names its key, because the operator
 * reading the refusal has a bucket in front of them.
 *
 * `since` is compared against the completion the copy carries, which is the same instant the
 * `erasure_request` row holds — the routine writes the copy from the one reading of the clock
 * its last step stamps the row with.
 */
export const replayCopiesSince = async (
  platform: PlatformPrincipal,
  door: ObjectDoor,
  since: Date,
): Promise<Result<readonly ReplayCopy[], Error>> => {
  const listed = await attempt(() => listPlatformObjects(platform, door, REPLAY_PREFIX));
  if (!listed.ok) return err(listed.error);
  if (!listed.value.ok) {
    return err(new Error(`erasure: the replay prefix was refused (${listed.value.error})`));
  }

  const copies: ReplayCopy[] = [];
  for (const key of listed.value.value) {
    // Sequential rather than in parallel: a restore's whole bucket of copies is read once, on a
    // machine that is also restoring three other stores, and the order nothing depends on is
    // not worth the burst of connections.
    const read = await attempt(() => copyAt(platform, door, key));
    if (!read.ok) return err(read.error);
    if (new Date(read.value.completedAt).getTime() > since.getTime()) copies.push(read.value);
  }
  return ok(copies);
};
