import { byCodeUnit } from "@better-answers/schema/code-unit";

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
  "This erasure rewrote every identifier that recorded this person as an actor, such as an " +
  "author or a verifier. It rewrote them in the repository's history, the index, the evidence, " +
  "the map and the backup copies listed below. Concept bodies can also name this person, in " +
  "text they wrote or text about them. Those concepts are listed below for their owner to " +
  "edit. An edit makes a new commit. The name stays in earlier commits, in " +
  `exports already made, and in backup copies taken before ${anchor}.`;

const beyondUse = (anchor: string, erasure: ErasureRecord): string =>
  `Backup copies taken before ${anchor} are beyond use. They are encrypted, they are ` +
  "restored only after a disaster, and only the escrowed credential can delete them. They " +
  `expire on these dates: ${stamped(erasure.beyondUseHourlyAt)} (hourly), ` +
  `${stamped(erasure.beyondUseDailyAt)} (daily), ${stamped(erasure.beyondUseWeeklyAt)} ` +
  `(weekly) and ${stamped(erasure.beyondUseMonthlyAt)} (monthly). If the platform is ever ` +
  "restored from one of these copies, it applies this erasure again before it serves any reads.";

const anchorNamed = (anchor: string): string =>
  `This erasure started at ${anchor}. The dates above count from that moment, not from the ` +
  "last backup. The erasure does not read the backup records, and the last backup was taken " +
  "before the erasure started. So each date above is the latest date that a copy can expire.";

const SIGN_IN_IDENTITY_REMOVED =
  "A person's sign-in identity is removed only by the erasure that removes them from their " +
  "last workspace.";

const INVITATIONS_WHEREVER_SENT =
  "The erasure that removes a person from their last workspace also deletes every invitation " +
  "sent to the address they sign in with, in any workspace. The invitation count above covers " +
  "this workspace only.";

const DOCUMENTS_WITHHELD =
  "The original files in the object store are not changed. Instead, the identifiers named in " +
  "this request are withheld from the text of every document in this workspace each time a " +
  "document is indexed, including documents added later. The documents found above are being " +
  "indexed again now.";

const EXPORTS_NOT_RECALLED =
  "This erasure cannot recall exports that were already made. No exports have been made.";

const NO_CONCEPT_NAMES = "None. No concept body names this person.";

export const NAMES_HEADING = "Concepts whose body names this person, for their owner to edit:";

export const STORES_HEADING = "What the erasure found and did, by store:";

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
      : [...input.concepts].sort(byCodeUnit).map((iri) => `- ${iri}`);
  return [
    `Erasure report for subject request ${input.request.id}.`,
    "",
    rewritten(anchor),
    "",
    beyondUse(anchor, input.erasure),
    "",
    anchorNamed(anchor),
    "",
    NAMES_HEADING,
    ...named,
    "",
    STORES_HEADING,
    ...input.map.map((entry) => `- ${entry.family}: ${wordsFor(input.actions[entry.family])}`),
    "",
    SIGN_IN_IDENTITY_REMOVED,
    "",
    INVITATIONS_WHEREVER_SENT,
    "",
    DOCUMENTS_WITHHELD,
    "",
    EXPORTS_NOT_RECALLED,
    "",
  ].join("\n");
};
