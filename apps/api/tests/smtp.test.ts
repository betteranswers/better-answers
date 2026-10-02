import { createServer, type Socket } from "node:net";
import { createInterface } from "node:readline";

import { createTransport, type SendMailOptions } from "nodemailer";
import { afterEach, describe, expect, it } from "vitest";

import { emailSender, pacedTransport } from "../src/smtp.ts";
import { capturingLogger } from "./harness.ts";

const SENDER = "better-answers <no-reply@better-answers.test>";

const REFUSED = "refused@example.test";

const REPLIES = new Map([
  ["EHLO", "250 loopback"],
  ["DATA", "354 go on"],
  ["QUIT", "221 bye"],
]);

const replyTo = (line: string): string => {
  const verb = line.slice(0, 4).toUpperCase();
  if (verb === "RCPT" && line.includes(REFUSED)) return "550 mailbox unavailable";
  return REPLIES.get(verb) ?? "250 ok";
};

/** Speaks just enough SMTP for one session, and says when each message's data ends. */
const converse = (socket: Socket, arrived: () => void): void => {
  let inData = false;
  socket.write("220 loopback\r\n");
  createInterface({ input: socket, crlfDelay: Infinity }).on("line", (line) => {
    if (inData) {
      if (line !== ".") return;
      inData = false;
      arrived();
      socket.write("250 queued\r\n");
      return;
    }
    const reply = replyTo(line);
    inData = reply.startsWith("354");
    socket.write(`${reply}\r\n`);
  });
};

/** A relay on loopback that keeps when each message arrived and how many connections it took. */
const loopbackRelay = async () => {
  const arrivedAtMs: number[] = [];
  const sockets: Socket[] = [];
  const relay = createServer((socket) => {
    sockets.push(socket);
    // A connection the transport drops at teardown is no fault of the sender's.
    socket.on("error", () => socket.destroy());
    converse(socket, () => arrivedAtMs.push(performance.now()));
  });
  await new Promise<void>((resolve) => relay.listen(0, "127.0.0.1", resolve));
  const address = relay.address();
  if (address === null || typeof address === "string") throw new Error("no port was bound");
  const closed = async (): Promise<void> => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => relay.close(resolve));
  };
  return { url: `smtp://127.0.0.1:${String(address.port)}`, arrivedAtMs, sockets, closed };
};

const teardowns: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const teardown of teardowns.splice(0).reverse()) await teardown();
});

const pacedThroughLoopback = async () => {
  const relay = await loopbackRelay();
  const transport = pacedTransport(relay.url);
  teardowns.push(relay.closed, () => transport.close());
  return { relay, send: emailSender(transport, SENDER, capturingLogger().logger) };
};

const sixAddresses = Array.from({ length: 6 }, (_, at) => `person${String(at)}@example.test`);

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

describe("the paced transport", () => {
  it("sends five emails in a second and holds the sixth", async () => {
    const { relay, send } = await pacedThroughLoopback();
    const startedMs = performance.now();

    await Promise.all(sixAddresses.map((to) => send({ to, subject: "S", text: "T" })));

    const inFirstSecond = relay.arrivedAtMs.filter((atMs) => atMs - startedMs < 950);
    expect(relay.arrivedAtMs).toHaveLength(6);
    expect(inFirstSecond).toHaveLength(5);
  });

  it("carries six emails over two connections", async () => {
    const { relay, send } = await pacedThroughLoopback();

    await Promise.all(sixAddresses.map((to) => send({ to, subject: "S", text: "T" })));

    expect(relay.sockets).toHaveLength(2);
  });

  it("still throws a refused email, and sends the next", async () => {
    const { relay, send } = await pacedThroughLoopback();

    await expect(send({ to: REFUSED, subject: "S", text: "T" })).rejects.toThrow(/550/);
    await send({ to: "a@example.test", subject: "S", text: "T" });

    expect(relay.arrivedAtMs).toHaveLength(1);
  });
});
