import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ASK_TO_JOIN_PERSON_RULE } from "../src/auth/constants.ts";
import { TRPC_ENDPOINT } from "../src/trpc/mount.ts";
import { appForSuite } from "./suite-app.ts";
import { NO_SESSION_ANSWERED, refusalOfCall, webSignedIn } from "./web-client.ts";

const app = appForSuite();

const REQUEST_ACCESS = `${TRPC_ENDPOINT}/person.requestAccess`;

const REASON = "I run the estimating desk and need the tender library.";

const ACKNOWLEDGED = { acknowledged: true };

const unknownSlug = (): string => `nobody-${Math.random().toString(36).slice(2)}`;

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

const answeredStatus = z.object({ data: z.object({ httpStatus: z.number() }) });

// An answer with no refusal on it is the acknowledgement, whose status tRPC does not hand over.
const statusOf = async (call: Promise<unknown>): Promise<number> => {
  const refused = answeredStatus.safeParse(await refusalOfCall(call));
  return refused.success ? refused.data.data.httpStatus : 200;
};

describe("a signed-in person asking to join a workspace over tRPC", () => {
  it("records the ask against a known slug, booked to them", async () => {
    const workspace = await app().provision();
    const { person, api } = await aSignedInPerson();

    const answered = await api.person.requestAccess.mutate({
      slug: workspace.slug,
      reason: REASON,
    });

    expect(answered).toEqual(ACKNOWLEDGED);
    expect(await asksBy(person.id)).toEqual([
      { workspace_id: workspace.workspaceId, reason: REASON, status: "waiting" },
    ]);
    const booked = await app().database.superuser.query(
      "SELECT act, actor FROM audit_event WHERE workspace_id = $1 AND act = 'people.request.asked'",
      [workspace.workspaceId],
    );
    expect(booked.rows).toEqual([{ act: "people.request.asked", actor: `human:${person.id}` }]);
  });

  it("answers alike for unknown, joined and already-waiting slugs", async () => {
    const joined = await app().provision();
    const waitedOn = await app().provision();
    const fresh = await app().provision();
    const { person, api } = await aSignedInPerson();
    await app().addMember(joined.workspaceId, person.id, "Viewer");
    const ask = (slug: string) => api.person.requestAccess.mutate({ slug, reason: REASON });
    await ask(waitedOn.slug);

    const answers = [
      await ask(fresh.slug),
      await ask(unknownSlug()),
      await ask(joined.slug),
      await ask(waitedOn.slug),
    ];

    expect(answers).toEqual([ACKNOWLEDGED, ACKNOWLEDGED, ACKNOWLEDGED, ACKNOWLEDGED]);
    expect((await asksBy(person.id)).map((ask) => ask.workspace_id)).toEqual([
      waitedOn.workspaceId,
      fresh.workspaceId,
    ]);
  });

  it("refuses a reason of spaces as malformed, writing nothing", async () => {
    const workspace = await app().provision();
    const { person, api } = await aSignedInPerson();

    const refused = await refusalOfCall(
      api.person.requestAccess.mutate({ slug: workspace.slug, reason: "   " }),
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
      slug: workspace.slug,
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
      .json(REQUEST_ACCESS, { slug: workspace.slug, reason: REASON });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject(NO_SESSION_ANSWERED);
  });

  it("refuses a person past their ceiling, and only them", async () => {
    const workspace = await app().provision();
    const { person, api } = await aSignedInPerson();
    const ask = (slug: string) => api.person.requestAccess.mutate({ slug, reason: REASON });
    const statuses: number[] = [];

    // The window is wall-clock aligned, so a burst straddling a boundary starts its count
    // again: ask until refused, not a fixed number.
    for (let attempt = 0; attempt <= ASK_TO_JOIN_PERSON_RULE.max * 2 + 1; attempt += 1) {
      const status = await statusOf(ask(unknownSlug()));
      statuses.push(status);
      if (status === 429) break;
    }
    const known = await refusalOfCall(ask(workspace.slug));
    const someoneElse = await aSignedInPerson();

    expect(statuses).toContain(429);
    expect(known).toMatchObject({ data: { httpStatus: 429, code: "TOO_MANY_REQUESTS" } });
    expect(await asksBy(person.id)).toEqual([]);
    expect(
      await someoneElse.api.person.requestAccess.mutate({ slug: workspace.slug, reason: REASON }),
    ).toEqual(ACKNOWLEDGED);
  });
});
