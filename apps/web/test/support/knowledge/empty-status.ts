import { assert, expect } from "vitest";

export const theOneEmptyStatus = (statuses: readonly HTMLElement[]): HTMLElement => {
  const empty = statuses.filter((status) => status.textContent === "");
  expect(empty, "more than one status was empty, or none was").toHaveLength(1);
  const [status] = empty;
  assert(status !== undefined);
  return status;
};
