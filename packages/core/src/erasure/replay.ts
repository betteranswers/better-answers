import type { PlatformPrincipal } from "../kernel/index.ts";
import { putPlatformObject, type ObjectDoor } from "../store/objects/index.ts";
import type { ErasureMap } from "./map.ts";
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
