import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { AskedRecord } from "@/features/questions/questions-api.ts";
import { QUESTIONS_KEYSTROKES as KEY } from "@/features/questions/questions-state.ts";
import { QUESTIONS_WORDS as WORDS } from "@/features/questions/questions-words.ts";
import { KEYSTROKE_WORDS, keystrokesOn } from "@/shared/keystroke-words.ts";
import { CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { holdProcedure } from "@test/stubbed-api.ts";
import { adaAnAdmin, FORBIDDEN, openAt, read } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

const QUESTIONS_ASKED = pageNamed(menuGroupIn(CONTROL_CENTRE, "questions"), "Questions Asked").path;

const FLAGGED_QUESTION = "How long do you keep audit logs for buyers?";

const NEWER_QUESTION = "Who can see the audit log?";

const AUDIT_CONCEPT = z.string().brand<"ConceptIri">().parse("01JCONCEPT0000000000000001");

const ASKED_BY = { kind: "platform" } as const satisfies AskedRecord["askedBy"];

const aRecord = (id: string, question: string, moreOf: Partial<AskedRecord> = {}): AskedRecord => ({
  id,
  askedAt: "2026-10-27T09:30:00.000Z",
  askedBy: ASKED_BY,
  transport: "trpc",
  collectionsNamed: [],
  question,
  verdict: "ok",
  judgeState: "judged",
  map: { state: "unknown" },
  flagged: false,
  concepts: [],
  drafted: null,
  feedback: [],
  ...moreOf,
});

const aFlagOnTheAuditQuestion = (): AskedRecord =>
  aRecord("01JRECORD0000000000000001A", FLAGGED_QUESTION, {
    flagged: true,
    feedback: [
      {
        id: "01JFEEDBACK00000000000001A",
        givenAt: "2026-10-27T09:40:00.000Z",
        verdict: "flag",
        reason: "wrong",
        note: null,
        disputed: { sentence: "Audit logs are kept for one year.", concept: AUDIT_CONCEPT },
        closedAs: null,
        closedAt: null,
      },
    ],
  });

const aFlagAndANewerQuestion = (): AskedRecord[] => [
  aFlagOnTheAuditQuestion(),
  aRecord("01JRECORD0000000000000002A", NEWER_QUESTION),
];

const pageOf = (records: readonly AskedRecord[], nextCursor: unknown = null) =>
  read({ records, nextCursor });

const openQuestions = async (records: readonly AskedRecord[], nextCursor: unknown = null) => {
  const api = adaAnAdmin();
  api.set("questions.asked", () => pageOf(records, nextCursor));
  await openAt(QUESTIONS_ASKED, api);
  const region = await screen.findByRole("region", { name: "Questions Asked" });
  await within(region).findByRole("button", { name: records[0]?.question ?? "" });
  return { api, region };
};

const rowsOf = (region: HTMLElement) => within(region).getAllByRole("listitem");

const rowButtonOf = (region: HTMLElement, question: string) =>
  within(region).getByRole("button", { name: question });

const recordOf = (question: string) => screen.queryByRole("dialog", { name: question });

const statusesWithText = (region: HTMLElement) =>
  within(region)
    .getAllByRole("status")
    .filter((status) => /\S/v.test(status.textContent));

const press = (key: string): void => {
  fireEvent.keyDown(document.activeElement ?? document.body, { key });
};

describe("Questions asked", () => {
  it("keeps the flag open and alerts when closing is refused", async () => {
    const { api, region } = await openQuestions(aFlagAndANewerQuestion());
    const closeFlag = holdProcedure(api, "questions.closeFlag");
    fireEvent.click(rowButtonOf(region, FLAGGED_QUESTION));
    const record = await screen.findByRole("dialog", { name: FLAGGED_QUESTION });

    fireEvent.click(
      within(within(record).getByRole("group", { name: WORDS.closeTheFlag })).getByRole("button", {
        name: WORDS.closing["no-fault-in-the-knowledge"],
      }),
    );
    closeFlag.reject(FORBIDDEN);

    await waitFor(() => {
      const refusals = within(record)
        .getAllByRole("alert")
        .filter((alert) => alert.textContent !== "");
      expect(refusals, "no alert appeared after the closing was refused").toHaveLength(1);
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(screen.getByRole("group", { name: WORDS.closeTheFlag })).getByRole("button", {
          name: WORDS.closing["fixed-in-the-knowledge"],
        }),
      );
    });
    press("Escape");
    await waitFor(() => {
      expect(recordOf(FLAGGED_QUESTION)).toBeNull();
    });
    const flagged = within(region).getByRole("region", { name: WORDS.flagged });
    expect(rowsOf(flagged).map((row) => row.textContent)).toEqual([
      expect.stringContaining(FLAGGED_QUESTION),
    ]);
  });

  it("opens no question by key after focus leaves the list", async () => {
    const { region } = await openQuestions(aFlagAndANewerQuestion());
    const atRest = statusesWithText(region).length;
    rowButtonOf(region, FLAGGED_QUESTION).focus();
    within(region).getByRole("heading", { level: 2 }).focus();

    press(KEY.open.key);

    expect(
      statusesWithText(region),
      "pressing the open key with no question in focus showed no message",
    ).toHaveLength(atRest + 1);
    expect(recordOf(FLAGGED_QUESTION)).toBeNull();
  });

  it("lists, opens and pages the questions by keyboard", async () => {
    const asked = Array.from({ length: 51 }, (_, nth) =>
      aRecord(`01JRECORD${String(nth).padStart(16, "0")}`, `Question number ${51 - nth}`),
    );
    const cursor = { id: asked[49]?.id, flagged: false };
    const api = adaAnAdmin();
    api.set("questions.asked", () => pageOf(asked.slice(0, 50), cursor));
    await openAt(QUESTIONS_ASKED, api);
    const region = await screen.findByRole("region", { name: "Questions Asked" });
    await within(region).findByRole("button", { name: "Question number 51" });
    expect(rowsOf(region)).toHaveLength(50);

    press("?");
    const keystrokes = await screen.findByRole("dialog", {
      name: keystrokesOn("Questions Asked"),
    });
    for (const { key } of Object.values(KEY)) {
      expect(within(keystrokes).getByText(key, { selector: "dt, dt *" })).toBeDefined();
    }
    press("Escape");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: KEYSTROKE_WORDS.button }),
    );

    api.set("questions.asked", () => pageOf(asked.slice(50), null));
    press(KEY.more.key);
    await waitFor(() => {
      expect(rowsOf(region)).toHaveLength(51);
    });
    const oldest = rowButtonOf(region, "Question number 1");
    await waitFor(() => {
      expect(document.activeElement, "focus did not land on the first older question").toBe(oldest);
    });

    press(KEY.open.key);
    expect(await screen.findByRole("dialog", { name: "Question number 1" })).toBeDefined();
    press("Escape");
    await waitFor(() => {
      expect(recordOf("Question number 1")).toBeNull();
    });
    expect(document.activeElement).toBe(oldest);
  });
});
