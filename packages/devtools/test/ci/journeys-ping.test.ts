import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  type Answer,
  deployScript,
  type Heard,
  listening,
  PATH_ONLY,
  type Ran,
  ran,
} from "./script-stand-ins.ts";

const scratch = mkdtempSync(path.join(tmpdir(), "journeys-ping-"));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const CHECK_UUID = "0b6c7a4e-3f1d-4c2a-9e8b-5d7f1a2c3e4b";

type Pinged = Ran & { readonly summary: string };

const pinged = async (args: readonly string[], url?: string): Promise<Pinged> => {
  const summary = path.join(mkdtempSync(path.join(scratch, "run-")), "summary");
  writeFileSync(summary, "");
  const result = await ran(deployScript("journeys-ping.sh"), args, {
    ...PATH_ONLY,
    GITHUB_STEP_SUMMARY: summary,
    JOURNEYS_PING_DELAY_SECONDS: "0",
    ...(url === undefined ? {} : { JOURNEYS_PING_URL: url }),
  });
  return { ...result, summary: readFileSync(summary, "utf8") };
};

type Sent = {
  readonly method: string;
  readonly path: string;
  readonly type: string | undefined;
  readonly body: string;
};

const sentOf = (heard: Heard): Sent => ({
  method: heard.method,
  path: heard.url,
  type: heard.headers["content-type"],
  body: heard.body,
});

/** Answers each ping with the next status given, and every ping past the list with the last. */
const answering = (statuses: readonly number[]) => {
  let asked = 0;
  return (): Answer => {
    const status = statuses[Math.min(asked, statuses.length - 1)] ?? 200;
    asked += 1;
    return { status, body: "OK" };
  };
};

const pingedThrough = async (
  statuses: readonly number[],
  args: readonly string[],
): Promise<Pinged & { readonly sent: readonly Sent[] }> => {
  let run: Pinged = { code: null, out: "", err: "", summary: "" };
  let sent: readonly Sent[] = [];
  await listening(answering(statuses), async (origin, heard) => {
    run = await pinged(args, `${origin}/${CHECK_UUID}`);
    sent = heard.map(sentOf);
  });
  return { ...run, sent };
};

const closedOrigin = async (): Promise<string> => {
  let closed = "";
  await listening(answering([200]), async (origin) => {
    closed = origin;
  });
  return closed;
};

const ping = (to: string, body: string): Sent => ({
  method: "POST",
  path: to,
  type: "text/plain",
  body,
});

const NOT_SET =
  "The journeys check was not pinged: JOURNEYS_PING_URL is not set in the production environment (RUNBOOK.md page 13, step 3).";

const undelivered = (last: string): string =>
  `The journeys check was not pinged: 3 attempts went undelivered (the last answer: ${last}).`;

const unpinged = (said: string) => ({
  code: 0,
  out: `::warning::${said}\n`,
  err: "",
  summary: `${said}\n`,
});

const USAGE = "::error::usage: journeys-ping.sh <held|fail|could-not-run> — ";

describe("the ping a journeys run sends", () => {
  it("pings the check's own URL with held as the body", async () => {
    expect(await pingedThrough([200], ["held"])).toEqual({
      code: 0,
      out: "pinged the journeys check: held\n",
      err: "",
      summary: "",
      sent: [ping(`/${CHECK_UUID}`, "held")],
    });
  });

  it.each(["fail", "could-not-run"])("pings %s as a failure, the word alone", async (word) => {
    expect(await pingedThrough([200], [word])).toEqual({
      code: 0,
      out: `pinged the journeys check: ${word}\n`,
      err: "",
      summary: "",
      sent: [ping(`/${CHECK_UUID}/fail`, word)],
    });
  });

  it("tries again after a 500, stopping at the first success", async () => {
    expect(await pingedThrough([500, 200], ["held"])).toEqual({
      code: 0,
      out: "pinged the journeys check: held\n",
      err: "",
      summary: "",
      sent: [ping(`/${CHECK_UUID}`, "held"), ping(`/${CHECK_UUID}`, "held")],
    });
  });
});

describe("a ping the journeys check never receives", () => {
  it("still exits 0 when every attempt is answered 500", async () => {
    const failure = ping(`/${CHECK_UUID}/fail`, "fail");

    expect(await pingedThrough([500], ["fail"])).toEqual({
      ...unpinged(undelivered("500")),
      sent: [failure, failure, failure],
    });
  });

  it("counts a redirect as undelivered, following none", async () => {
    const held = ping(`/${CHECK_UUID}`, "held");

    expect(await pingedThrough([302], ["held"])).toEqual({
      ...unpinged(undelivered("302")),
      sent: [held, held, held],
    });
  });

  it("says no answer when nothing listens at the URL", async () => {
    expect(await pinged(["could-not-run"], `${await closedOrigin()}/${CHECK_UUID}`)).toEqual(
      unpinged(undelivered("no answer")),
    );
  });

  it("sends nothing and says so when the URL is unset", async () => {
    expect(await pinged(["held"])).toEqual(unpinged(NOT_SET));
  });

  it("sends nothing and says so when the URL is empty", async () => {
    expect(await pinged(["held"], "")).toEqual(unpinged(NOT_SET));
  });
});

describe("the words journeys-ping.sh takes", () => {
  it("refuses a word outside the three, sending nothing", async () => {
    expect(await pingedThrough([200], ["passed"])).toEqual({
      code: 2,
      out: "",
      err: `${USAGE}passed is not one of the three outcome words\n`,
      summary: "",
      sent: [],
    });
  });

  it("refuses no word, or two, sending nothing", async () => {
    const refused = (given: number) => ({
      code: 2,
      out: "",
      err: `${USAGE}takes one argument, and was given ${String(given)}\n`,
      summary: "",
      sent: [],
    });

    expect([await pingedThrough([200], []), await pingedThrough([200], ["held", "fail"])]).toEqual([
      refused(0),
      refused(2),
    ]);
  });
});

describe("the ping URL, a secret", () => {
  it("is named in no stream or summary, on any path", async () => {
    const runs = [
      await pingedThrough([200], ["held"]),
      await pingedThrough([500], ["fail"]),
      await pingedThrough([302], ["could-not-run"]),
      await pinged(["held"], `${await closedOrigin()}/${CHECK_UUID}`),
    ];

    expect(
      runs
        .map(({ out, err, summary }) => `${out}${err}${summary}`)
        .filter((said) => said.includes(CHECK_UUID) || said.includes("127.0.0.1")),
    ).toEqual([]);
  });
});
