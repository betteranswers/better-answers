import { describe, expect, it } from "vitest";

import { ASK_TO_JOIN_PERSON_RULE } from "../src/auth/constants.ts";
import { TRPC_ENDPOINT } from "../src/trpc/mount.ts";
import { appForSuite } from "./suite-app.ts";
import { NO_SESSION_ANSWERED, refusalOfCall, statusOf, webSignedIn } from "./web-client.ts";

const app = appForSuite();

const REQUEST_ACCESS = `${TRPC_ENDPOINT}/person.requestAccess`;

const REASON = "I run the estimating desk and need the tender library.";

const ACKNOWLEDGED = { acknowledged: true };

const unknownShortName = (): string => `nobody-${Math.random().toString(36).slice(2)}`;

const aSignedInPerson = async () => {
  const person = await app().person();
  return { person, ...(await webSignedIn(app(), person.email)) };
};

const asksBy = async (personId: string) => {
  const found = await app().database.superuser.query<{
    workspace_id: string;
    reason: string;
    status: string;
  }>(
    `SELECT workspace_id, reason, status FROM access_request
      WHERE requester_id = $1 ORDER BY created_at, id`,
    [personId],
  );
  return found.rows;
};

describe("a signed-in person asking to join a workspace over tRPC", () => {
  it("books the ask for a known short name to them", async () => {
    const workspace = await app().provision();
    const { person, api } = await aSignedInPerson();

    const answered = await api.person.requestAccess.mutate({
      shortName: workspace.shortName,
      reason: REASON,
    });

    expect(answered).toEqual(ACKNOWLEDGED);
    expect(await asksBy(person.id)).toEqual([
      { workspace_id: workspace.workspaceId, reason: REASON, status: "waiting" },
    ]);
    const booked = await app().database.superuser.query(
      "SELECT action AS act, actor FROM audit_event WHERE workspace_id = $1 AND action = 'people.request.asked'",
      [workspace.workspaceId],
    );
    expect(booked.rows).toEqual([{ act: "people.request.asked", actor: `human:${person.id}` }]);
  });

  it("answers alike for unknown, joined and already-waiting short names", async () => {
    const joined = await app().provision();
    const waitedOn = await app().provision();
    const fresh = await app().provision();
    const { person, api } = await aSignedInPerson();
    await app().addMember(joined.workspaceId, person.id, "Viewer");
    const ask = (shortName: string) =>
      api.person.requestAccess.mutate({ shortName, reason: REASON });
    await ask(waitedOn.shortName);

    const answers = [
      await ask(fresh.shortName),
      await ask(unknownShortName()),
      await ask(joined.shortName),
      await ask(waitedOn.shortName),
    ];

    expect(answers).toEqual([ACKNOWLEDGED, ACKNOWLEDGED, ACKNOWLEDGED, ACKNOWLEDGED]);
    expect((await asksBy(person.id)).map((asked) => asked.workspace_id)).toEqual([
      waitedOn.workspaceId,
      fresh.workspaceId,
    ]);
  });

  it("refuses a reason of spaces as malformed, writing nothing", async () => {
    const workspace = await app().provision();
    const { person, api } = await aSignedInPerson();

    const refused = await refusalOfCall(
      api.person.requestAccess.mutate({ shortName: workspace.shortName, reason: "   " }),
    );

    expect(refused).toMatchObject({
      data: { httpStatus: 400, refusal: { word: "malformed", class: "malformed" } },
    });
    expect(await asksBy(person.id)).toEqual([]);
  });

  it("books the ask to the session's person, never one named", async () => {
    const workspace = await app().provision();
    const { person, client } = await aSignedInPerson();
    const other = await app().person();

    const response = await client.json(REQUEST_ACCESS, {
      shortName: workspace.shortName,
      reason: REASON,
      requesterId: other.id,
    });

    expect(response.status).toBe(200);
    expect(await asksBy(other.id)).toEqual([]);
    expect(await asksBy(person.id)).toHaveLength(1);
  });

  it("refuses a sessionless caller, sending them to sign in", async () => {
    const workspace = await app().provision();

    const response = await app()
      .client()
      .json(REQUEST_ACCESS, { shortName: workspace.shortName, reason: REASON });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject(NO_SESSION_ANSWERED);
  });

  it("refuses a person past their ceiling, and only them", async () => {
    const workspace = await app().provision();
    const { person, api, client } = await aSignedInPerson();
    const statuses: number[] = [];

    // The window is wall-clock aligned, so a burst straddling a boundary starts its count
    // again: ask until refused, not a fixed number.
    for (let attempt = 0; attempt <= ASK_TO_JOIN_PERSON_RULE.max * 2 + 1; attempt += 1) {
      const status = await statusOf(
        api.person.requestAccess.mutate({ shortName: unknownShortName(), reason: REASON }),
      );
      statuses.push(status);
      if (status === 429) break;
    }
    const known = await client.json(REQUEST_ACCESS, {
      shortName: workspace.shortName,
      reason: REASON,
    });
    const someoneElse = await aSignedInPerson();

    expect(statuses.at(-1)).toBe(429);
    expect(statuses.filter((status) => status === 200).length).toBeGreaterThanOrEqual(10);
    expect(known.status).toBe(429);
    const retryAfter = Number(known.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(3600);
    expect(await known.json()).toMatchObject({
      error: { data: { code: "TOO_MANY_REQUESTS", retryAfterSeconds: retryAfter } },
    });
    expect(await asksBy(person.id)).toEqual([]);
    expect(
      await someoneElse.api.person.requestAccess.mutate({
        shortName: workspace.shortName,
        reason: REASON,
      }),
    ).toEqual(ACKNOWLEDGED);
  });

  it("answers known and unknown short names no sooner than 250ms", async () => {
    const workspace = await app().provision();
    const { api } = await aSignedInPerson();
    const timed = async (shortName: string): Promise<number> => {
      const started = performance.now();
      await api.person.requestAccess.mutate({ shortName, reason: REASON });
      return performance.now() - started;
    };

    expect(await timed(unknownShortName())).toBeGreaterThanOrEqual(250);
    expect(await timed(workspace.shortName)).toBeGreaterThanOrEqual(250);
  });
});
