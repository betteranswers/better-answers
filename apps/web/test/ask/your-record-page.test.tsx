import { describe, expect, it, vi } from "vitest";

import { ASK, detailAt, menuGroupIn, pageNamed } from "@/shared/navigation.ts";
import { openedWhereTheApiNamesNone } from "@test/detail/not-found-detail.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

const A_RECORD = detailAt(
  pageNamed(menuGroupIn(ASK, "ask"), "Your Questions"),
  "01JXRECRD0000000000000000A",
);

describe("a record of Your Questions", () => {
  it("draws not found when the api names no such record", async () => {
    const drawn = await openedWhereTheApiNamesNone(A_RECORD, "ask.yourRecord");

    expect(drawn.notFound).toBeDefined();
    expect(drawn.alerts).toHaveLength(0);
  });
});
