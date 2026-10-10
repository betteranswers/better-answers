import { describe, expect, it } from "vitest";

import { TRPC_ENDPOINT } from "../src/trpc/mount.ts";
import { holdAnAuthenticator } from "./factor-harness.ts";
import { confirmWithTheAuthenticator } from "./flow.ts";
import { signedInByEmailOnly } from "./provoke.ts";
import { appForSuite } from "./suite-app.ts";
import { NO_SESSION_ANSWERED, refusalOfCall, webClientOf, webSignedIn } from "./web-client.ts";

const app = appForSuite();

describe("reading a person's own workspaces over tRPC", () => {
  it("lists each workspace with the person's role, in name order", async () => {
    const beta = await app().provision({ name: "Beta" });
    const acme = await app().provision({ name: "Acme" });
    const person = await app().person();
    await app().addMember(beta.workspaceId, person.id, "Admin");
    await app().addMember(acme.workspaceId, person.id, "Viewer");
    const { api } = await webSignedIn(app(), person.email);

    expect(await api.person.workspaces.query()).toEqual([
      { workspace: { id: acme.workspaceId, name: "Acme" }, role: "Viewer" },
      { workspace: { id: beta.workspaceId, name: "Beta" }, role: "Admin" },
    ]);
  });

  it("answers each person their own workspaces, never another's", async () => {
    const calder = await app().provision({ name: "Calder" });
    const ryedale = await app().provision({ name: "Ryedale" });
    const priya = await app().person();
    await app().addMember(ryedale.workspaceId, priya.id, "Editor");
    const asCaldersAdmin = await webSignedIn(app(), calder.admin.email);
    const asPriya = await webSignedIn(app(), priya.email);

    expect(await asCaldersAdmin.api.person.workspaces.query()).toEqual([
      { workspace: { id: calder.workspaceId, name: "Calder" }, role: "Admin" },
    ]);
    expect(await asPriya.api.person.workspaces.query()).toEqual([
      { workspace: { id: ryedale.workspaceId, name: "Ryedale" }, role: "Editor" },
    ]);
  });

  it("refuses a pending second factor, then answers once confirmed", async () => {
    const thornby = await app().provision({ name: "Thornby" });
    const key = await holdAnAuthenticator(app(), thornby.admin.id);
    const client = await signedInByEmailOnly(app(), thornby.admin.email);
    const { api } = webClientOf(client);

    const whilePending = await refusalOfCall(api.person.workspaces.query());
    await confirmWithTheAuthenticator(client, key);

    expect(whilePending).toMatchObject({
      data: { httpStatus: 412, refusal: { word: "second-factor-pending", class: "precondition" } },
    });
    expect(await api.person.workspaces.query()).toEqual([
      { workspace: { id: thornby.workspaceId, name: "Thornby" }, role: "Admin" },
    ]);
  });

  it("refuses a caller with no session", async () => {
    const response = await app().client().fetch(`${TRPC_ENDPOINT}/person.workspaces`);

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject(NO_SESSION_ANSWERED);
  });
});
