export { targetOf, writeConceptDelta, writeConceptVisibility } from "./write.ts";
export type { ConceptDelta, ConceptVisibility } from "./write.ts";
export {
  MAP_WALK_DEPTH,
  walkFromEntries,
  walkConceptsFromEntries,
  walkTimedOut,
  analyseMap,
  walkToEntries,
  walkFrom,
  walkTo,
} from "./walk.ts";
export type { WalkStep } from "./walk.ts";
export { countMap, sweepNonLiveGenerations } from "./generations.ts";
export type { MapCounts, SweptGeneration } from "./generations.ts";
export { sectionAt, sentenceAt } from "./sentence.ts";
