import { describe, expect, it } from "vitest";

import { heldBack, type Api } from "./stubbed-api.ts";

const LIST = "members.list";

const THE_LIST = { result: { data: ["Ada"] } };

const REFUSED = { error: { message: "forbidden" } };

const api = (): Api => new Map([[LIST, () => THE_LIST]]);

const asked = (table: Api): Promise<unknown> => Promise.resolve(table.get(LIST)?.());

const aTurnLater = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve);
  });

const settled = async (answer: Promise<unknown>): Promise<boolean> =>
  Promise.race([answer.then(() => true), aTurnLater().then(() => false)]);

describe("a held procedure", () => {
  it("stays unanswered and pending until the test answers it", async () => {
    const table = api();
    const held = heldBack(table, LIST);
    expect(held.pending, "pending before anything asked").toBe(false);

    const answer = asked(table);
    await held.asked;

    expect(held.pending).toBe(true);
    expect(await settled(answer)).toBe(false);

    held.resolve();

    expect(await answer).toBe(THE_LIST);
    expect(held.pending).toBe(false);
  });

  it("answers every waiting ask with the answer it is given", async () => {
    const table = api();
    const held = heldBack(table, LIST);
    const first = asked(table);
    const second = asked(table);

    held.resolve({ result: { data: ["Grace"] } });

    expect(await first).toEqual({ result: { data: ["Grace"] } });
    expect(await second).toEqual({ result: { data: ["Grace"] } });
    expect(held.asks).toBe(2);
  });

  it("answers its own answer when it was given one", async () => {
    const table = api();
    const held = heldBack(table, LIST, { result: { data: [] } });
    const answer = asked(table);

    held.resolve();

    expect(await answer).toEqual({ result: { data: [] } });
  });

  it("answers a refusal when the test rejects it", async () => {
    const table = api();
    const held = heldBack(table, LIST);
    const answer = asked(table);
    await held.asked;

    held.reject(REFUSED);

    expect(await answer).toBe(REFUSED);
    expect(held.pending).toBe(false);
  });

  it("leaves a procedure it does not hold answering at once", async () => {
    const table = api();
    table.set("members.invitations", () => THE_LIST);
    heldBack(table, LIST);

    expect(await Promise.resolve(table.get("members.invitations")?.())).toBe(THE_LIST);
  });
});
