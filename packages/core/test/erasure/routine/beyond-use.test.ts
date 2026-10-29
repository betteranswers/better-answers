import { expect, it } from "vitest";

import { beyondUseFrom } from "../../../src/erasure/routine/routine.ts";

const isoOf = (dates: ReturnType<typeof beyondUseFrom>) => ({
  hourly: dates.hourly.toISOString(),
  daily: dates.daily.toISOString(),
  weekly: dates.weekly.toISOString(),
  monthly: dates.monthly.toISOString(),
});

it.each([
  [
    "2026-06-01T12:00:00.000Z",
    {
      hourly: "2026-06-03T12:00:00.000Z",
      daily: "2026-07-01T12:00:00.000Z",
      weekly: "2026-07-27T12:00:00.000Z",
      monthly: "2026-12-01T12:00:00.000Z",
    },
  ],
  [
    "2026-08-31T12:00:00.000Z",
    {
      hourly: "2026-09-02T12:00:00.000Z",
      daily: "2026-09-30T12:00:00.000Z",
      weekly: "2026-10-26T12:00:00.000Z",
      monthly: "2027-02-28T12:00:00.000Z",
    },
  ],
  [
    "2026-02-01T12:00:00.000Z",
    {
      hourly: "2026-02-03T12:00:00.000Z",
      daily: "2026-03-03T12:00:00.000Z",
      weekly: "2026-03-29T12:00:00.000Z",
      monthly: "2026-08-01T12:00:00.000Z",
    },
  ],
])("dates beyond use from %s by calendar interval", (anchoredAt, expected) => {
  expect(isoOf(beyondUseFrom(new Date(anchoredAt)))).toEqual(expected);
});
