import { describe, expect, it } from "vitest";

import { TRPC_ENDPOINT } from "../src/trpc/mount.ts";
import { appForSuite } from "./suite-app.ts";
import { NO_SESSION_ANSWERED, webSignedIn } from "./web-client.ts";

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

  it("refuses a caller with no session", async () => {
    const response = await app().client().fetch(`${TRPC_ENDPOINT}/person.workspaces`);

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject(NO_SESSION_ANSWERED);
  });
});
