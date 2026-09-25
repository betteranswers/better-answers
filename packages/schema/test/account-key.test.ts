import { describe, expect, it } from "vitest";

import { testData } from "./factory.ts";
import { withRollback } from "./harness.ts";
import { ADMITTED, postgresForSuite, refusalOf } from "./probes.ts";

const db = postgresForSuite();

const THE_KEY = "account_provider_id_account_id_uidx";

describe("the account's key, a provider and its account id", () => {
  it("refuses a provider's account id twice, even to its holder", async () => {
    await withRollback(db().pool, async (client) => {
      const seed = testData(client);
      const holder = await seed.account({ providerId: "google", accountId: "google-sub-1" });
      const someoneElse = await seed.user();

      expect({
        holder: await refusalOf(client, () =>
          seed.account({ userId: holder.userId, providerId: "google", accountId: "google-sub-1" }),
        ),
        someoneElse: await refusalOf(client, () =>
          seed.account({ userId: someoneElse.id, providerId: "google", accountId: "google-sub-1" }),
        ),
      }).toEqual({ holder: THE_KEY, someoneElse: THE_KEY });
    });
  });

  it("admits one id at two providers, two ids at one", async () => {
    await withRollback(db().pool, async (client) => {
      const seed = testData(client);
      const holder = await seed.account({ providerId: "google", accountId: "google-sub-1" });

      expect({
        atASecondProvider: await refusalOf(client, () =>
          seed.account({ userId: holder.userId, providerId: "github", accountId: "google-sub-1" }),
        ),
        aSecondAccountId: await refusalOf(client, () =>
          seed.account({ userId: holder.userId, providerId: "google", accountId: "google-sub-2" }),
        ),
      }).toEqual({ atASecondProvider: ADMITTED, aSecondAccountId: ADMITTED });
    });
  });
});
