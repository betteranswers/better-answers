import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SEARCH_PAGE } from "@/shared/knowledge/concept-address.ts";
import { detailAt } from "@/shared/navigation.ts";
import { anOpenedConcept } from "@test/knowledge/search-answers.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { adaAnAdmin, aRefusalAnswer, openAt, read } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

const A_CONCEPT = detailAt(SEARCH_PAGE, "01JRETENTN000000000000000A");

const VERIFIED_BY_ADA = "Verified by Ada Lovelace · 3 March 2026";

const aConceptVerifiedOnce = () =>
  read({
    found: true,
    concept: {
      ...anOpenedConcept(
        "https://better-answers.com/c/01JRETENTN000000000000000A",
        {
          title: "Audit Logs Retention",
          type: "Answer",
          verified: [{ by: "process:better-answers-import", at: "2025-01-01T00:00:00Z" }],
        },
        "Audit logs are kept for six years.",
      ),
      trust: {
        tier: "human-reviewed",
        status: "current",
        verifiedBy: "Ada Lovelace",
        verifiedAt: "2026-03-03T09:41:00.000Z",
        rider: null,
      },
      trustWords: VERIFIED_BY_ADA,
      verifications: [
        {
          tier: "human-reviewed",
          actor: "human:01JBZ6Q2V7Y9K3M5N8P0R2T4W6",
          name: "Ada Lovelace",
          at: "2026-03-03T09:41:00.000Z",
        },
      ],
    },
  });

describe("the concept page", () => {
  it("shows not found when the api rejects the id", async () => {
    const api = adaAnAdmin();
    api.set("knowledge.open", () => aRefusalAnswer("malformed", "invalid", 400));
    await openAt(A_CONCEPT, api);

    const main = within(screen.getByRole("main"));
    expect(await main.findByRole("link", { name: "Back to Search" })).toBeDefined();
    expect(screen.queryByRole("article")).toBeNull();
    expect(main.queryAllByRole("alert")).toHaveLength(0);
    expect(main.queryAllByRole("status").filter((each) => each.textContent !== "")).toHaveLength(0);
  });

  it("lists the verifications the header trust comes from", async () => {
    const api = adaAnAdmin();
    api.set("knowledge.open", aConceptVerifiedOnce);
    await openAt(A_CONCEPT, api);

    const article = within(await screen.findByRole("article"));
    const history = within(article.getByRole("region", { name: "Verification" }));
    expect(article.getByText(VERIFIED_BY_ADA)).toBeDefined();
    expect(history.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "3 March 2026 · by a person",
    ]);
    expect(article.queryByText(/1 January 2025/u)).toBeNull();
  });
});
