import { describe, expect, it } from "vitest";
import { z } from "zod";

import { llmPurpose } from "@better-answers/schema";
import { testData, withRollback } from "@better-answers/schema/testing";

import { contractFixture } from "./contract-fixture.ts";
import { postgresForSuite } from "./suite-postgres.ts";

const purpose = z.enum(llmPurpose.enumValues);
const fixtureSchema = z.object({
  workspaces: z.array(z.object({ id: z.string(), name: z.string() })),
  model_choices: z.array(
    z.object({
      id: z.string(),
      workspace_id: z.string(),
      purpose,
      provider: z.string(),
      model: z.string(),
      dimensions: z.number().int().positive().nullable(),
    }),
  ),
  calls: z.array(
    z.object({
      workspace_id: z.string(),
      purpose,
      expect_model_choice_id: z.string().nullable(),
    }),
  ),
});

const fixture = contractFixture("model-choice", fixtureSchema);

const db = postgresForSuite();

describe("the model-choice agreement", () => {
  it("resolves every fixtured call to its expected model choice", async () => {
    await withRollback(db().pool, async (client) => {
      const seed = testData(client);
      for (const workspace of fixture.workspaces) {
        await seed.workspace(workspace);
      }
      for (const modelChoice of fixture.model_choices) {
        await seed.modelChoice({
          id: modelChoice.id,
          workspaceId: modelChoice.workspace_id,
          purpose: modelChoice.purpose,
          provider: modelChoice.provider,
          model: modelChoice.model,
          dimensions: modelChoice.dimensions,
        });
      }

      await client.query("SET LOCAL ROLE app_rt");
      for (const call of fixture.calls) {
        await client.query("SELECT set_config('app.workspace_id', $1, true)", [call.workspace_id]);
        const resolved = await client.query("SELECT id FROM model_choice_for($1::llm_purpose)", [
          call.purpose,
        ]);
        const modelChoiceId: string | null = resolved.rows[0]?.id ?? null;
        expect({ ...call, resolved: modelChoiceId }).toEqual({
          ...call,
          resolved: call.expect_model_choice_id,
        });
      }
    });
  });

  it("refuses a second model choice for one workspace and purpose", async () => {
    await withRollback(db().pool, async (client) => {
      const seed = testData(client);
      const workspace = await seed.workspace();
      const modelChoice = await seed.modelChoice({ workspaceId: workspace.id });

      await expect(
        seed.modelChoice({ workspaceId: workspace.id, purpose: modelChoice.purpose }),
      ).rejects.toThrow(/duplicate key|unique/);
    });
  });
});
