import { describe, expect, it } from "vitest";

import { testData } from "./support/factory.ts";
import { withRollback } from "./support/harness.ts";
import { postgresForSuite } from "./support/probes.ts";

const db = postgresForSuite();

describe("the factory's defaults", () => {
  it("spells no word in a default person's address", async () => {
    const person = await withRollback(db().pool, (client) => testData(client).user());

    expect(person.email).toMatch(/^\d+@example\.invalid$/);
  });

  it("spells no word in a default group's name", async () => {
    const group = await withRollback(db().pool, (client) => testData(client).group());

    expect(group.name).toMatch(/^Group \d+$/);
  });
});
