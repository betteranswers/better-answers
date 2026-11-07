import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { QUESTION_MAX } from "@/features/ask/ask-state.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { adaAnAdmin, openAt } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

const questionBox = () => screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Question" });

describe("the New Question page", () => {
  it("starts with an empty question box", async () => {
    await openAt("/ask/new-question", adaAnAdmin());

    expect((await questionBox()).value).toBe("");
  });

  it("holds the question the address carries, then drops it", async () => {
    const router = await openAt("/ask/new-question?question=zebra+crossings", adaAnAdmin());

    expect((await questionBox()).value).toBe("zebra crossings");
    expect(router.state.location.searchStr).toBe("");
  });

  it("holds no more than the question's limit", async () => {
    await openAt(`/ask/new-question?question=${"a".repeat(QUESTION_MAX + 10)}`, adaAnAdmin());

    expect((await questionBox()).value).toHaveLength(QUESTION_MAX);
  });
});
