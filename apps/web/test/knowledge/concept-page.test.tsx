import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SEARCH_PAGE } from "@/shared/knowledge/concept-address.ts";
import { detailAt } from "@/shared/navigation.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { adaAnAdmin, aRefusalAnswer, openAt } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

const A_CONCEPT = detailAt(SEARCH_PAGE, "01JRETENTN000000000000000A");

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
});
