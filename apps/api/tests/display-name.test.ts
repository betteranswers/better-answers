import { describe, expect, it } from "vitest";

import { TRPC_ENDPOINT } from "../src/trpc/mount.ts";
import { displayNameHeldBy } from "./provoke.ts";
import { appForSuite } from "./suite-app.ts";
import { NO_SESSION_ANSWERED, refusalOfCall, webSignedIn } from "./web-client.ts";

const app = appForSuite();

const SET_DISPLAY_NAME = `${TRPC_ENDPOINT}/person.setDisplayName`;

const aPersonWithNoDisplayName = () => app().person(undefined, "");

describe("a signed-in person setting their own display name over tRPC", () => {
  it("takes it from a person in no workspace, trimmed", async () => {
    const person = await aPersonWithNoDisplayName();
    const { api } = await webSignedIn(app(), person.email);

    const set = await api.person.setDisplayName.mutate({ displayName: "  Priya Shah " });

    expect(set).toEqual({ personId: person.id, displayName: "Priya Shah" });
    expect(await displayNameHeldBy(app(), person.id)).toBe("Priya Shah");
  });

  it("takes it from a two-workspace member who picked neither", async () => {
    const first = await app().provision();
    const second = await app().provision();
    const person = await aPersonWithNoDisplayName();
    await app().addMember(first.workspaceId, person.id, "Viewer");
    await app().addMember(second.workspaceId, person.id, "Viewer");
    const { api } = await webSignedIn(app(), person.email);

    const membership = await refusalOfCall(api.session.membership.query());
    const set = await api.person.setDisplayName.mutate({ displayName: "Sam Okoro" });

    expect(membership).toMatchObject({ data: { refusal: { word: "no-active-workspace" } } });
    expect(set.displayName).toBe("Sam Okoro");
    expect(await displayNameHeldBy(app(), person.id)).toBe("Sam Okoro");
  });

  it("refuses a bad name with the rule's word, writing nothing", async () => {
    const person = await app().person(undefined, "Priya Shah");
    const { api } = await webSignedIn(app(), person.email);

    const refused = await refusalOfCall(
      api.person.setDisplayName.mutate({ displayName: "Priya <priya@acme.invalid>" }),
    );

    expect(refused).toMatchObject({
      data: {
        httpStatus: 400,
        refusal: { word: "display-name-angle-bracket", class: "malformed" },
      },
    });
    expect(await displayNameHeldBy(app(), person.id)).toBe("Priya Shah");
  });

  it("refuses a sessionless caller, sending them to sign in", async () => {
    const response = await app().client().json(SET_DISPLAY_NAME, { displayName: "Mallory" });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject(NO_SESSION_ANSWERED);
  });

  it("records one identity-set audit event by person id, not name", async () => {
    const person = await aPersonWithNoDisplayName();
    const { api } = await webSignedIn(app(), person.email);
    const displayName = `Ada ${person.id.slice(-6)}`;

    await api.person.setDisplayName.mutate({ displayName });

    const recorded = await app().database.superuser.query(
      `SELECT act, actor, subject_id, detail, row_to_json(identity_audit_event)::text AS whole
         FROM identity_audit_event WHERE subject_id = $1 AND act = 'people.person.named'`,
      [person.id],
    );
    expect(recorded.rows).toEqual([
      {
        act: "people.person.named",
        actor: `human:${person.id}`,
        subject_id: person.id,
        detail: {},
        whole: expect.not.stringContaining(displayName),
      },
    ]);
  });
});
