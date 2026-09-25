import { describe, expect, it } from "vitest";

import { displayNameHeldBy, signedInClient } from "./provoke.ts";
import { appForSuite } from "./suite-app.ts";

const app = appForSuite();

describe("the update-user endpoint, to a person who is signed in", () => {
  it.each([
    ["set", "Mallory <mallory@acme.invalid>"],
    ["blank", ""],
  ])("refuses to %s their display name, leaving it unchanged", async (_act, name) => {
    const person = await app().person(undefined, "Priya Shah");
    const client = await signedInClient(app(), person.email);
    expect((await client.fetch("/get-session")).status).toBe(200);

    const updated = await client.json("/update-user", { name });

    expect(updated.status).toBe(404);
    expect(await displayNameHeldBy(app(), person.id)).toBe("Priya Shah");
  });
});

describe("a first sign-in that carries a name of its own", () => {
  it("stores no name, so only the display-name act sets one", async () => {
    const client = app().client();
    const email = `first-${Date.now()}@acme.invalid`;
    await client.json("/email-otp/send-verification-otp", { email, type: "sign-in" });

    const signedIn = await client.json("/sign-in/email-otp", {
      email,
      otp: app().codeSentTo(email),
      name: "Mallory <mallory@acme.invalid>",
    });

    expect(signedIn.status).toBe(200);
    const found = await app().database.superuser.query<{ name: string }>(
      'SELECT name FROM "user" WHERE email = $1',
      [email],
    );
    expect(found.rows).toEqual([{ name: "" }]);
  });
});
