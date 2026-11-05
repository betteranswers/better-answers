import { describe, expect, it, vi } from "vitest";

import { WAITING_ON_YOU } from "@/features/inbox/inbox-state.ts";
import { detailAt } from "@/shared/navigation.ts";
import { openedWhereTheApiNamesNone } from "@test/detail/not-found-detail.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

const A_SUGGESTION = detailAt(WAITING_ON_YOU, "01JXSGGST0000000000000000A");

describe("a suggestion on Waiting on You", () => {
  it("shows Page Not Found when the suggestion does not exist", async () => {
    const drawn = await openedWhereTheApiNamesNone(A_SUGGESTION, "inbox.item");

    expect(drawn.notFound).toBeDefined();
    expect(drawn.alerts).toHaveLength(0);
  });
});
