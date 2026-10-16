import { AsyncLocalStorage } from "node:async_hooks";

import { afterEach, describe, expect, it, vi } from "vitest";

import { REFUSAL_PAGES } from "../src/auth/index.ts";
import { connectIn, driveToPage, setActiveWorkspace } from "./flow.ts";
import type { TestApp } from "./harness.ts";
import { appForSuite } from "./suite-app.ts";

const app = appForSuite();

const consentsGiven = async (): Promise<unknown> =>
  (await app().database.superuser.query("SELECT count(*)::int AS n FROM oauth_consent")).rows[0];

const runInStore: AsyncLocalStorage<unknown>["run"] = Reflect.get(
  AsyncLocalStorage.prototype,
  "run",
);

const landingBeforeTheLibrary = (landing: () => Promise<unknown>): void => {
  vi.spyOn(AsyncLocalStorage.prototype, "run").mockImplementation(function (
    this: AsyncLocalStorage<unknown>,
    store: unknown,
    callback: (...args: unknown[]) => unknown,
    ...args: unknown[]
  ) {
    const granting = typeof store === "object" && store !== null && "drawn" in store;
    const work = granting ? async () => (await landing(), callback(...args)) : callback;
    return Reflect.apply(runInStore, this, [store, work, ...args]);
  });
};

afterEach(() => {
  vi.restoreAllMocks();
});

const anAdminOnAcmesPage = async (on: TestApp) => {
  const acme = await on.provision({ name: "Acme" });
  const zenith = await on.provision({ name: "Zenith" });
  const client = on.client();
  const consent = await driveToPage(on, client, acme.admin);
  expect(consent.pathname).toBe("/consent");
  await on.addMember(zenith.workspaceId, acme.admin.id, "Admin");
  return { acme, zenith, client, consent };
};

describe("a consent grant in the library", () => {
  it("answers a switch landing mid-grant with the moved page", async () => {
    const { acme, zenith, client, consent } = await anAdminOnAcmesPage(app());
    const before = await consentsGiven();
    landingBeforeTheLibrary(async () => {
      expect((await setActiveWorkspace(client, zenith.workspaceId)).status).toBe(200);
    });

    const refused = await client.form(`/consent${consent.search}`, connectIn(acme.workspaceId));

    const { title, why } = REFUSAL_PAGES.workspaceMoved;
    expect({ status: refused.status, codeSentTo: refused.headers.get("location") }).toEqual({
      status: 409,
      codeSentTo: null,
    });
    expect(await refused.text()).toMatch(new RegExp(`${title}[\\s\\S]*${why}`));
    expect(await consentsGiven()).toEqual(before);
  });

  it("refuses a session pending its second factor mid-grant", async () => {
    const acme = await app().provision({ name: "Acme" });
    const zenith = await app().provision({ name: "Zenith" });
    const editor = await app().person();
    await app().addMember(acme.workspaceId, editor.id, "Editor");
    const client = app().client();
    const consent = await driveToPage(app(), client, editor);
    expect(consent.pathname).toBe("/consent");
    const before = await consentsGiven();
    // An Admin anywhere must hold a factor, so the session holds none and is pending.
    landingBeforeTheLibrary(() => app().addMember(zenith.workspaceId, editor.id, "Admin"));

    const refused = await client.form(`/consent${consent.search}`, connectIn(acme.workspaceId));

    expect(refused.status).toBe(400);
    expect(refused.headers.get("location")).toBeNull();
    expect(await consentsGiven()).toEqual(before);
  });
});
