import { describe, expect, it } from "vitest";

import { boundarySchemas, ulid } from "@better-answers/schema";

import type { EmailMessage } from "../src/email.ts";
import { toldTheOperator } from "../src/trpc/name-flag-email.ts";
import { capturingLogger, PUBLIC_URL } from "./harness.ts";

const raised = {
  workspaceId: boundarySchemas.workspace.select.shape.id.parse(ulid()),
  workspaceName: "Hollins Freight",
  personId: boundarySchemas.user.select.shape.id.parse(ulid()),
  displayName: "Rude Name",
};

describe("telling the operator of a flag", () => {
  it("sends nothing, logging an error, where no operator is configured", async () => {
    const sent: EmailMessage[] = [];
    const { logger, logs } = capturingLogger();

    await toldTheOperator(
      {
        mail: {
          send: async (message) => {
            sent.push(message);
          },
          publicUrl: PUBLIC_URL,
          operatorAddress: undefined,
        },
        log: logger,
      },
      raised,
    );

    expect(sent).toEqual([]);
    expect(logs).toContainEqual(
      expect.objectContaining({
        level: 50,
        event: "trpc.email_failed",
        person_id: raised.personId,
        msg: "no operator address is configured, so the name flag was not emailed",
      }),
    );
    expect(JSON.stringify(logs)).not.toContain("Rude Name");
  });
});
