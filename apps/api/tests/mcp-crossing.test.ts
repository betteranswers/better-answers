import { describe, expect, it } from "vitest";

import { err } from "@better-answers/core/kernel";

import { crossing } from "../src/mcp/crossing.ts";
import type { RefusalAnswer } from "../src/refusal.ts";
import { capturingLogger } from "./harness.ts";

const FIRST_ID = "01K6H0A7Q3W9E2R5T8Y1U4I6O0";
const SECOND_ID = "01K6H0A7Q3W9E2R5T8Y1U4I6O1";

/** No entry answers items yet, so the crossing is reached as the surface's entries reach it. */
describe("a refusal naming items, crossing the MCP surface", () => {
  it("answers the set's word and class alone", async () => {
    const { logger, logs } = capturingLogger();

    const answered = await crossing(
      logger,
      "remove_people",
      async () =>
        err<RefusalAnswer>({
          word: "last-admin",
          items: { [FIRST_ID]: "last-admin", [SECOND_ID]: "no-such-member" },
        }),
      () => "removed",
    );

    expect(answered).toStrictEqual({
      content: [{ type: "text", text: "Refused: last-admin (precondition)." }],
      isError: true,
    });
    expect(
      logs.map((line) => [line["event"], line["entry"], line["refusal"], line["class"]]),
    ).toEqual([["mcp.refused", "remove_people", "last-admin", "precondition"]]);
    expect(JSON.stringify(logs)).not.toMatch(/01K6H0A7Q3W9E2R5T8Y1U4I6O[01]/);
  });
});
