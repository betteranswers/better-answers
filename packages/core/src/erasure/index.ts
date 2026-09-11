/**
 * Slice: **erasure** — erasure requests, suppression, replay on restore (ADRs 0020, 0022).
 *
 * The one slice permitted to import other slices' interfaces, because an erasure is by
 * nature an act over the whole estate. It sits at the top of the slice graph: nothing
 * imports `erasure` (ADR 0029 rule 4).
 *
 * What is here so far is the *subject request* — the act that records one, the clock it runs
 * on and the Admin-only read of its identifier set (`requests.ts`) — and the *erasure map*,
 * the per-store finder over an exhaustive union of every family that holds text about a
 * person (`map.ts`).
 */

export { ERASURE_FAMILIES, erasureMapOf } from "./map.ts";
export type { ErasureFamily, ErasureFamilyDescriptor, ErasureMap } from "./map.ts";
export { deadlineOf, dueDateOf, recordSubjectRequest, subjectRequestFor } from "./requests.ts";
export type {
  ReadSubjectRequestRefusal,
  RecordSubjectRequestInput,
  RecordSubjectRequestRefusal,
  SubjectIdentifiers,
  SubjectRequest,
  SubjectRequestRecorded,
} from "./requests.ts";
