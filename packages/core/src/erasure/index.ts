/**
 * Slice: **erasure** — erasure requests, suppression, replay on restore (ADRs 0020, 0022).
 *
 * The one slice permitted to import other slices' interfaces, because an erasure is by
 * nature an act over the whole estate. It sits at the top of the slice graph: nothing
 * imports `erasure` (ADR 0029 rule 4).
 *
 * What is here so far is the *subject request* — the act that records one, the clock it runs
 * on and the Admin-only read of its identifier set (`requests.ts`) — the *erasure map*, the
 * per-store finder over an exhaustive union of every family that holds text about a person,
 * with the access answer read back off it (`map.ts`) — and the **routine** itself
 * (`routine.ts`), which runs one erasure request end to end under the platform's own
 * principal and `pg_advisory_lock(41)`, with the report it writes (`report.ts`).
 */

export { accessAnswerOf, ERASURE_FAMILIES, erasureMapOf } from "./map.ts";
export type { AccessAnswer, ErasureFamily, ErasureFamilyDescriptor, ErasureMap } from "./map.ts";
export { erasureReportOf } from "./report.ts";
export type { ErasureAction, ErasureActions, ErasureRecord, ErasureReportInput } from "./report.ts";
export { ERASURE, runErasure } from "./routine.ts";
export type { ErasurePrincipal, ErasureRefusal, ErasureRun } from "./routine.ts";
export { deadlineOf, dueDateOf, recordSubjectRequest, subjectRequestFor } from "./requests.ts";
export type {
  ReadSubjectRequestRefusal,
  RecordSubjectRequestInput,
  RecordSubjectRequestRefusal,
  SubjectIdentifiers,
  SubjectRequest,
  SubjectRequestRecorded,
} from "./requests.ts";
