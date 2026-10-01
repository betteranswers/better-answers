import { describe, expect, it } from "vitest";

import { codeIn } from "./harness.ts";
import { appForSuite } from "./suite-app.ts";

const app = appForSuite();

/** The email the code request sent, with the code read from that same email. */
const signInEmailTo = async (email: string) => {
  await app().client().json("/email-otp/send-verification-otp", { email, type: "sign-in" });
  const message = app().emails.findLast(({ to }) => to === email);
  const code = message === undefined ? undefined : codeIn(message);
  if (message === undefined || code === undefined) throw new Error(`no code went to ${email}`);
  return { message, code };
};

describe("the sign-in email", () => {
  it("names the product in its subject and never the code", async () => {
    const person = await app().person();

    const { message, code } = await signInEmailTo(person.email);

    expect(message.subject).toBe("Sign in to better-answers");
    expect(message.subject).not.toContain(code);
  });

  it("holds the code alone on one line of its text", async () => {
    const person = await app().person();

    const { message, code } = await signInEmailTo(person.email);

    expect(message.text).toBe(
      [
        "Your better-answers sign-in code:",
        "",
        code,
        "",
        "Enter it where you asked for it. It works for five minutes.",
        "",
        "If you did not ask to sign in, ignore this email.",
      ].join("\n"),
    );
  });

  it("holds the same code in large type in its HTML", async () => {
    const person = await app().person();

    const { message, code } = await signInEmailTo(person.email);

    expect(message.html).toMatch(new RegExp(`<p style="[^"]*font:600 32px[^"]*">${code}</p>`));
    expect(message.html).toContain('<html lang="en-GB">');
  });
});
