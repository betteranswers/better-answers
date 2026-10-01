import { createTransport, type SendMailOptions } from "nodemailer";
import { describe, expect, it } from "vitest";

import { emailSender } from "../src/smtp.ts";
import { capturingLogger } from "./harness.ts";

const SENDER = "better-answers <no-reply@better-answers.test>";

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

  it("hands a relay's non-error refusal on as an error", async () => {
    const transport = createTransport({
      name: "refusing",
      version: "1",
      send: (_mail, callback) => {
        // @ts-expect-error -- a relay that refuses with a string, which the callback's type forbids
        callback("550 mailbox unavailable");
      },
    });
    const send = emailSender(transport, SENDER, capturingLogger().logger);

    const refused = await send({ to: "a@example.test", subject: "S", text: "T" }).then(
      () => undefined,
      (cause: unknown) => cause,
    );

    expect(refused).toBeInstanceOf(Error);
    expect(refused).toMatchObject({ message: "550 mailbox unavailable" });
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
