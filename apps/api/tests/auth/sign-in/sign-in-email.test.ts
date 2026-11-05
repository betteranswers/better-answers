import { describe, expect, it } from "vitest";

import { codeIn, PUBLIC_URL } from "../../support/harness/harness.ts";
import { appForSuite } from "../../support/suite-app.ts";

const app = appForSuite();

const signInEmailTo = async (email: string) => {
  await app().client().json("/email-otp/send-verification-otp", { email, type: "sign-in" });
  const sent = app().emails.filter(({ to }) => to === email);
  expect(sent, "a code request did not send exactly one email").toHaveLength(1);
  const [message] = sent;
  const code = message === undefined ? undefined : codeIn(message);
  if (message === undefined || code === undefined) throw new Error(`no code was sent to ${email}`);
  return { message, code };
};

describe("the sign-in email", () => {
  it("names the product in its subject and never the code", async () => {
    const person = await app().person();

    const { message, code } = await signInEmailTo(person.email);

    expect(message.subject).toBe("Sign in to better-answers");
    expect(message.subject).not.toContain(code);
  });

  it("puts the link and the code on separate lines", async () => {
    const person = await app().person();

    const { message, code } = await signInEmailTo(person.email);

    expect(message.text).toBe(
      [
        "Sign in to better-answers with this link, in the browser where you asked:",
        "",
        `${PUBLIC_URL}/sign-in/link#${app().linkSentTo(person.email)}`,
        "",
        "Or enter this code there:",
        "",
        code,
        "",
        "The link and the code work once, for five minutes.",
        "",
        "If you did not ask to sign in, ignore this email.",
      ].join("\n"),
    );
  });

  it("finds the code when the link also contains digits", () => {
    const message = {
      to: "a@example.test",
      subject: "S",
      text: ["https://app.example.test/sign-in/link#a123456b", "", "654321"].join("\n"),
    };

    expect(codeIn(message)).toBe("654321");
  });

  it("shows the code in large type in its HTML", async () => {
    const person = await app().person();

    const { message, code } = await signInEmailTo(person.email);

    expect(message.html).toMatch(new RegExp(`<p style="[^"]*font:600 32px[^"]*">${code}</p>`));
    expect(message.html).toContain('<html lang="en-GB">');
  });
});
