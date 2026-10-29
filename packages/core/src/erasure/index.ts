export { eraseFromTheIdentitySet } from "./routine/identity.ts";
export type { IdentityArm } from "./routine/identity.ts";
export {
  erasureMatchesIn,
  floorNotCleared,
  normalisedIdentifier,
  soughtIdentifiersOf,
} from "./identifiers.ts";
export { accessAnswerOf, ERASURE_FAMILIES, erasureMapOf } from "./map.ts";
export type { AccessAnswer, ErasureFamily, ErasureFamilyDescriptor, ErasureMap } from "./map.ts";
export { subjectNamedBy } from "./needles.ts";
export { rederiveAfterErasure } from "./routine/rederive.ts";
export { rehearseErasure, seedSyntheticSubject } from "./rehearsal.ts";
export type { ErasureRehearsed, RehearsalRefusal } from "./rehearsal.ts";
export { replayCopiesSince } from "./replay.ts";
export { replayableErasures, replayErasures } from "./replay-erasures.ts";
export type { ReplayedErasure } from "./replay-erasures.ts";
export { beyondUseFrom, runErasure } from "./routine/routine.ts";
export { ERASURE } from "./routine/vocabulary.ts";
export type {
  ErasureDoors,
  ErasureLog,
  ErasureLogLine,
  QuestionsLogLine,
  ErasureRun,
  RunErasureRefusal,
} from "./routine/vocabulary.ts";
export { deadlineOf, dueDateOf, recordSubjectRequest, subjectRequestFor } from "./requests.ts";
export { suppressInTheWorkspace } from "./suppressions.ts";
export { ERASURE_REFUSALS } from "./vocabulary.ts";
export type {
  ReadSubjectRequestRefusal,
  RecordSubjectRequestInput,
  RecordSubjectRequestRefusal,
  SubjectIdentifiers,
  SubjectRequest,
  SubjectRequestRecorded,
} from "./requests.ts";
