import { describe, expect, it } from "vitest";

import { TRPC_ENDPOINT } from "../src/trpc/mount.ts";
import { displayNameHeldBy } from "./provoke.ts";
import { appForSuite } from "./suite-app.ts";
import { refusalOfCall, webSignedIn } from "./web-client.ts";

const app = appForSuite();

const SET_DISPLAY_NAME = `${TRPC_ENDPOINT}/person.setDisplayName`;

const aPersonWithNoDisplayName = () => app().person(undefined, "");

describe("a signed-in person setting their own display name over tRPC", () => {
  it("takes it from a person who belongs to no workspace, trimmed as the rule takes it", async () => {
    const person = await aPersonWithNoDisplayName();
    const { api } = await webSignedIn(app(), person.email);

    const set = await api.person.setDisplayName.mutate({ displayName: "  Priya Shah " });

    expect(set).toEqual({ personId: person.id, displayName: "Priya Shah" });
    expect(await displayNameHeldBy(app(), person.id)).toBe("Priya Shah");
  });

  it("takes it from a member of two workspaces who has picked neither, whom every workspace procedure refuses", async () => {
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

  it("sends a name the rule refuses back as the rule's own word, under the status its class carries, and writes nothing", async () => {
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

  it("refuses a caller with no session, in the word that sends them to sign in", async () => {
    const response = await app().client().json(SET_DISPLAY_NAME, { displayName: "Mallory" });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { data: { refusal: { word: "no-session", class: "unauthenticated" } } },
    });
  });

  it("records the act as one row of the identity-set ledger, naming the person by person id and never by the name", async () => {
    const person = await aPersonWithNoDisplayName();
    const { api } = await webSignedIn(app(), person.email);
    const displayName = `Ada ${person.id.slice(-6)}`;

    await api.person.setDisplayName.mutate({ displayName });

    const recorded = await app().database.superuser.query(
      `SELECT act, actor, subject_id, detail, row_to_json(identity_audit_event)::text AS whole
         FROM identity_audit_event WHERE subject_id = $1`,
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
