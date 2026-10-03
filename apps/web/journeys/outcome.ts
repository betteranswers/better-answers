import { test } from "@playwright/test";

/** The word the release workflow reads. could-not-run outranks fail, which outranks held. */
export type Outcome = "held" | "fail" | "could-not-run";

type Annotation = { readonly type: string; readonly description?: string };

const ROLE = "journeys:role";
const COULD_NOT_RUN = "journeys:could-not-run";
const FAILED = "journeys:failed";

export const playsTheRole = (role: string): void => {
  test.info().annotations.push({ type: ROLE, description: role });
};

/** The release goes unjudged. The reason reaches the run's summary, so it never names an address. */
export const couldNotRun = (reason: string): never => {
  test.info().annotations.push({ type: COULD_NOT_RUN, description: reason });
  throw new Error(`could not run: ${reason}`);
};

/** The release failed. The reason reaches the run's summary, so it never names an address. */
export const failed = (reason: string): never => {
  test.info().annotations.push({ type: FAILED, description: reason });
  throw new Error(reason);
};

const describedAs = (annotations: readonly Annotation[], type: string): string | undefined =>
  annotations.find((annotation) => annotation.type === type)?.description;

export const roleIn = (annotations: readonly Annotation[]): string | undefined =>
  describedAs(annotations, ROLE);

export const whyItCouldNotRun = (annotations: readonly Annotation[]): string | undefined =>
  describedAs(annotations, COULD_NOT_RUN);

export const whyItFailed = (annotations: readonly Annotation[]): string | undefined =>
  describedAs(annotations, FAILED);
