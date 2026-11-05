import { describe, expect, it } from "vitest";

import { holdProcedure, type Api } from "./stubbed-api.ts";

const LIST = "members.list";

const LIST_RESPONSE = { result: { data: ["Ada"] } };

const ERROR_RESPONSE = { error: { message: "forbidden" } };

const api = (): Api => new Map([[LIST, () => LIST_RESPONSE]]);

const request = (table: Api): Promise<unknown> => Promise.resolve(table.get(LIST)?.());

const nextTask = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve);
  });

const settled = async (answer: Promise<unknown>): Promise<boolean> =>
  Promise.race([answer.then(() => true), nextTask().then(() => false)]);

describe("a held procedure", () => {
  it("stays pending until the test resolves it", async () => {
    const table = api();
    const held = holdProcedure(table, LIST);
    expect(held.pending, "the procedure was pending before any request").toBe(false);

    const answer = request(table);
    await held.asked;

    expect(held.pending).toBe(true);
    expect(await settled(answer)).toBe(false);

    held.resolve();

    expect(await answer).toBe(LIST_RESPONSE);
    expect(held.pending).toBe(false);
  });

  it("resolves every waiting request with the given response", async () => {
    const table = api();
    const held = holdProcedure(table, LIST);
    const first = request(table);
    const second = request(table);

    held.resolve({ result: { data: ["Grace"] } });

    expect(await first).toEqual({ result: { data: ["Grace"] } });
    expect(await second).toEqual({ result: { data: ["Grace"] } });
    expect(held.asks).toBe(2);
  });

  it("resolves with the response passed to holdProcedure", async () => {
    const table = api();
    const held = holdProcedure(table, LIST, { result: { data: [] } });
    const answer = request(table);

    held.resolve();

    expect(await answer).toEqual({ result: { data: [] } });
  });

  it("returns the error response when the test rejects it", async () => {
    const table = api();
    const held = holdProcedure(table, LIST);
    const answer = request(table);
    await held.asked;

    held.reject(ERROR_RESPONSE);

    expect(await answer).toBe(ERROR_RESPONSE);
    expect(held.pending).toBe(false);
  });

  it("lets other procedures respond immediately", async () => {
    const table = api();
    table.set("members.invitations", () => LIST_RESPONSE);
    holdProcedure(table, LIST);

    expect(await Promise.resolve(table.get("members.invitations")?.())).toBe(LIST_RESPONSE);
  });
});
