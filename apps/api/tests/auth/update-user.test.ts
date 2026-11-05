import { describe, expect, it } from "vitest";

import { displayNameHeldBy, signedInClient } from "../support/provoke.ts";
import { appForSuite } from "../support/suite-app.ts";

const app = appForSuite();

describe("the update-user endpoint for a signed-in person", () => {
  it.each([
    ["set", "Mallory <mallory@acme.invalid>"],
    ["blank", ""],
  ])("answers 404 when asked to %s the display name", async (_action, name) => {
    const person = await app().person(undefined, "Priya Shah");
    const client = await signedInClient(app(), person.email);
    expect((await client.fetch("/get-session")).status).toBe(200);

    const updated = await client.json("/update-user", { name });

    expect(updated.status).toBe(404);
    expect(await displayNameHeldBy(app(), person.id)).toBe("Priya Shah");
  });
});

describe("a first sign-in that sends a name", () => {
  it("stores an empty name instead of the one sent", async () => {
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
