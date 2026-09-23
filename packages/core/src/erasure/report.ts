import type { ErasureFamily, ErasureMap } from "./map.ts";
import type { SubjectRequest } from "./requests.ts";

export type ErasureAction = Readonly<Record<string, string | number | boolean | null>>;

export type ErasureActions = Readonly<Partial<Record<ErasureFamily, ErasureAction>>>;

export type ErasureRecord = {
  readonly id: string;
  readonly anchoredAt: Date;
  readonly beyondUseHourlyAt: Date;
  readonly beyondUseDailyAt: Date;
  readonly beyondUseWeeklyAt: Date;
  readonly beyondUseMonthlyAt: Date;
};

export type ErasureReportInput = {
  readonly request: Pick<SubjectRequest, "id">;
  readonly erasure: ErasureRecord;
  readonly actions: ErasureActions;
  readonly map: ErasureMap;

  readonly concepts: readonly string[];
};

const stamped = (at: Date): string => at.toISOString();

const rewritten = (anchor: string): string =>
  "Every actor identifier for this person has been rewritten across the repository's history, " +
  "the index, the evidence and the map, and in the backup copies listed below. Names this " +
  "person wrote or that were written about them inside concept bodies are listed for the " +
  "owner to edit; an edit is a new commit and does not remove the name from earlier commits, " +
  `from copies already exported, or from backup copies taken before ${anchor}.`;

const beyondUse = (anchor: string, erasure: ErasureRecord): string =>
  `Backup copies taken before ${anchor} are beyond use: restored only in a disaster, ` +
  "encrypted at rest, deletable only by the escrowed credential, expiring on " +
  `${stamped(erasure.beyondUseHourlyAt)} · ${stamped(erasure.beyondUseDailyAt)} · ` +
  `${stamped(erasure.beyondUseWeeklyAt)} · ${stamped(erasure.beyondUseMonthlyAt)}. ` +
  "Should a restore from such a copy occur, this request is re-applied before the platform " +
  "serves reads.";

const ANCHOR_NAMED =
  "The anchor above is the instant this routine took the erasure lock, not the stamp of the " +
  "last dump before it: no backup run is recorded, so the last dump precedes the anchor and " +
  "every date above is the latest a copy can expire.";

// One sentence on every arm, with no count: printed on one arm alone, it would say which ran.
const INVITATIONS_WHEREVER_SENT =
  "Invitations sent to the address a person signs in with are deleted wherever they were sent, " +
  "by the request that ends their last membership; the invitation line above counts this " +
  "workspace's alone.";

const OBJECT_STORE_UNTOUCHED =
  "The object store is untouched: a company document that mentions a person is suppressed " +
  "when it is next reprocessed, never deleted.";

const EXPORTS_NOT_RECALLED = "Exports already issued are not recalled. None have been issued.";

const NO_CONCEPT_NAMES = "None: no concept body names this person.";

const wordsFor = (action: ErasureAction | undefined): string => {
  const fields = Object.entries(action ?? {});
  if (fields.length === 0) return "nothing recorded";
  return fields
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([field, value]) => `${field} ${String(value)}`)
    .join(", ");
};

export const erasureReportOf = (input: ErasureReportInput): string => {
  const anchor = stamped(input.erasure.anchoredAt);
  const named =
    input.concepts.length === 0
      ? [NO_CONCEPT_NAMES]
      : [...input.concepts].sort().map((iri) => `- ${iri}`);
  return [
    `Erasure report for subject request ${input.request.id}.`,
    "",
    rewritten(anchor),
    "",
    beyondUse(anchor, input.erasure),
    "",
    ANCHOR_NAMED,
    "",
    "Names inside concept bodies, for the owner to edit:",
    ...named,
    "",
    "Where this person was held, and what the routine did:",
    ...input.map.map((entry) => `- ${entry.family}: ${wordsFor(input.actions[entry.family])}`),
    "",
    INVITATIONS_WHEREVER_SENT,
    "",
    OBJECT_STORE_UNTOUCHED,
    "",
    EXPORTS_NOT_RECALLED,
    "",
  ].join("\n");
};
