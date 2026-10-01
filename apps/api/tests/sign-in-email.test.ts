import { createTransport, type SendMailOptions } from "nodemailer";
import { describe, expect, it } from "vitest";

import { emailSender } from "../src/smtp.ts";
import { capturingLogger } from "./harness.ts";
import { appForSuite } from "./suite-app.ts";

const app = appForSuite();

const SENDER = "better-answers <no-reply@better-answers.test>";

/** The email the code request sent, with the code the harness read from it. */
const signInEmailTo = async (email: string) => {
  await app().client().json("/email-otp/send-verification-otp", { email, type: "sign-in" });
  const message = app().emails.findLast(({ to }) => to === email);
  if (message === undefined) throw new Error(`no email went to ${email}`);
  return { message, code: app().codeSentTo(email) };
};

/** A transport that keeps what it was handed, in place of a relay. */
const keepingTransport = () => {
  const kept: SendMailOptions[] = [];
  const transport = createTransport({
    name: "keeping",
    version: "1",
    send: (mail, callback) => {
      kept.push(mail.data);
      callback(null, { envelope: { from: false, to: [] }, messageId: "<kept@test>" });
    },
  });
  return { transport, kept };
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

describe("the SMTP sender", () => {
  it("sends the text and the HTML part together", async () => {
    const { transport, kept } = keepingTransport();
    const send = emailSender(transport, SENDER, capturingLogger().logger);

    await send({ to: "a@example.test", subject: "S", text: "the text", html: "<p>the html</p>" });

    expect(kept).toEqual([
      {
        from: SENDER,
        to: "a@example.test",
        subject: "S",
        text: "the text",
        html: "<p>the html</p>",
        headers: {},
      },
    ]);
  });

  it("refuses every send when no transport is configured", async () => {
    const { logger, logs } = capturingLogger();
    const send = emailSender(undefined, SENDER, logger);

    await expect(
      send({ to: "a@example.test", subject: "S", text: "T", html: "<p>T</p>" }),
    ).rejects.toThrow("no email transport is configured");
    expect(logs).toMatchObject([
      { to_domain: "example.test", msg: "no email transport is configured" },
    ]);
  });
});
