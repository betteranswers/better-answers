import { describe, expect, it } from "vitest";
import { z } from "zod";

import { whileWritesAreRefused } from "@better-answers/core/testing/postgres";

import { confirmedByTheHarness } from "./factor-harness.ts";
import { authorizeUrl, continueAfterPostLogin, pkce } from "./flow.ts";
import { PUBLIC_URL, type TestClient } from "./harness.ts";
import { servedApp } from "./suite-app.ts";

const app = servedApp();

const LINK_PAGE = "/sign-in/link";
const DESCRIBE = "/sign-in-link/describe";
const SIGN_IN_BY_LINK = "/sign-in-link/sign-in";
const SEND_CODE = "/email-otp/send-verification-otp";
const CONNECTED_SOURCE_COOKIE = "__Host-better-answers.sign-in-link";

const DEAD = { state: "dead" };

const AS_A_PAGE = { headers: { accept: "text/html" } };

const sessionShape = z.object({ user: z.object({ email: z.string() }) }).nullable();

const signInRowsOf = async (email: string) =>
  (
    await app().database.superuser.query<{ detail: unknown }>(
      `SELECT e.detail FROM identity_audit_event e JOIN "user" u ON u.id = e.subject_id
        WHERE e.action = 'people.person.signed_in' AND u.email = $1`,
      [email],
    )
  ).rows.map((row) => row.detail);

/** Asks for a code as `client`, and answers the code and the link token the email carried. */
const askedFor = async (client: TestClient, email: string, extra: Record<string, string> = {}) => {
  const asked = await client.json(SEND_CODE, { email, type: "sign-in", ...extra });
  expect(asked.status, "the code request was refused").toBe(200);
  return { asked, code: app().codeSentTo(email), token: app().linkSentTo(email) };
};

const describeLink = (client: TestClient, token: string) => client.json(DESCRIBE, { token });

const describedAs = async (client: TestClient, token: string): Promise<unknown> =>
  (await describeLink(client, token)).json();

const signedInAs = async (client: TestClient): Promise<string | undefined> => {
  const session = sessionShape.parse(await (await client.fetch("/get-session")).json());
  return session?.user.email;
};

/** A fresh link, with one of its address's rows rewritten behind the api's back. */
const aLinkAfterRewriting = async (prefix: "sign-in-otp-" | "sign-in-link-", set: string) => {
  const person = await app().person();
  const asking = app().client();
  const { token } = await askedFor(asking, person.email);
  await app().database.superuser.query(`UPDATE verification SET ${set} WHERE identifier = $1`, [
    `${prefix}${person.email.toLowerCase()}`,
  ]);
  return { person, asking, token };
};

/** What reading a link and then signing in with it answer. */
const readAndSpent = async (client: TestClient, token: string) => ({
  read: await describedAs(client, token),
  status: (await client.json(SIGN_IN_BY_LINK, { token })).status,
});

const READS_DEAD = { read: DEAD, status: 410 };

const ageTheCode = (email: string) =>
  app().database.superuser.query(
    `UPDATE verification SET expires_at = now() - interval '1 minute'
      WHERE identifier IN ('sign-in-otp-' || $1, 'sign-in-link-' || $1)`,
    [email.toLowerCase()],
  );

const triesSpentOn = async (email: string): Promise<string | undefined> => {
  const read = await app().database.superuser.query<{ value: string }>(
    "SELECT value FROM verification WHERE identifier = $1",
    [`sign-in-otp-${email.toLowerCase()}`],
  );
  return read.rows[0]?.value.split(":").at(-1);
};

describe("the sign-in email's link", () => {
  it("carries the link page with its token in the fragment", async () => {
    const person = await app().person();

    const { token } = await askedFor(app().client(), person.email);

    const message = app().emails.findLast(({ to }) => to === person.email);
    expect(token).toMatch(/^[A-Za-z0-9]{43}$/);
    expect(message?.text.split("\n")).toContain(`${PUBLIC_URL}${LINK_PAGE}#${token}`);
    expect(message?.html).toContain(`href="${PUBLIC_URL}${LINK_PAGE}#${token}"`);
  });
});

/** Refuses the link's own row alone, so the library's code row still lands. */
const whileLinksAreRefused = async <T>(work: () => Promise<T>): Promise<T> => {
  const superuser = app().database.superuser;
  await superuser.query(
    `CREATE OR REPLACE FUNCTION test_refuse_link() RETURNS trigger LANGUAGE plpgsql AS $$
     BEGIN RAISE EXCEPTION 'the store refused a link row'; END $$`,
  );
  await superuser.query(
    `CREATE TRIGGER test_refuse_link BEFORE INSERT ON verification FOR EACH ROW
     WHEN (NEW.identifier LIKE 'sign-in-link-%') EXECUTE FUNCTION test_refuse_link()`,
  );
  try {
    return await work();
  } finally {
    await superuser.query("DROP TRIGGER test_refuse_link ON verification");
    await superuser.query("DROP FUNCTION test_refuse_link()");
  }
};

const linkRowsOf = async (email: string): Promise<number> =>
  (
    await app().database.superuser.query(
      "SELECT 1 FROM verification WHERE identifier = 'sign-in-link-' || $1",
      [email.toLowerCase()],
    )
  ).rowCount ?? -1;

describe("the code request", () => {
  it("still sends the code when its link cannot be kept", async () => {
    const person = await app().person();

    const asked = await whileLinksAreRefused(() =>
      app().client().json(SEND_CODE, { email: person.email, type: "sign-in" }),
    );

    expect(asked.status).toBe(200);
    expect(app().codeSentTo(person.email)).toMatch(/^\d{6}$/);
    expect(() => app().linkSentTo(person.email)).toThrow("no sign-in link was sent");
    expect(app().logs.some((line) => line["event"] === "auth.link_not_kept")).toBe(true);
  });

  it("keeps one link when two codes are asked at once", async () => {
    const person = await app().person();

    await Promise.all([
      app().client().json(SEND_CODE, { email: person.email, type: "sign-in" }),
      app().client().json(SEND_CODE, { email: person.email, type: "sign-in" }),
    ]);

    expect(await linkRowsOf(person.email)).toBe(1);
  });

  it("binds the browser that asked with a host-only cookie", async () => {
    const person = await app().person();

    const { asked } = await askedFor(app().client(), person.email);

    const [cookie] = asked.headers.getSetCookie();
    expect(cookie).toMatch(new RegExp(`^${CONNECTED_SOURCE_COOKIE}=[A-Za-z0-9_-]{43};`));
    expect(cookie?.split("; ").slice(1).toSorted()).toEqual(
      ["HttpOnly", "Max-Age=300", "Path=/", "SameSite=Lax", "Secure"].toSorted(),
    );
  });

  it("refuses a cross-site request, setting no cookie and sending nothing", async () => {
    const person = await app().person();
    const client = app().client();

    const refused = await client.fetch(SEND_CODE, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://elsewhere.example" },
      body: JSON.stringify({ email: person.email, type: "sign-in" }),
    });

    expect(refused.status).toBe(403);
    expect(refused.headers.getSetCookie()).toEqual([]);
    expect(app().emails.filter(({ to }) => to === person.email)).toEqual([]);
  });
});

describe("reading a link", () => {
  it("offers the browser that asked a sign-in as its address", async () => {
    const person = await app().person();
    const client = app().client();
    const { token } = await askedFor(client, person.email);

    expect(await describedAs(client, token)).toEqual({
      state: "bound",
      address: person.email,
      carried: "",
    });
  });

  it("shows another browser the code, leaving it signed out", async () => {
    const person = await app().person();
    const asking = app().client();
    const { code, token } = await askedFor(asking, person.email);
    const phone = app().client();

    const read = await describedAs(phone, token);

    expect(read).toEqual({ state: "elsewhere", code, until: expect.any(String) });
    expect(await signedInAs(phone)).toBeUndefined();
    const typed = await asking.json("/sign-in/email-otp", { email: person.email, otp: code });
    expect(typed.status).toBe(200);
    expect(await signedInAs(asking)).toBe(person.email.toLowerCase());
  });

  it("answers alike for unknown, spent and expired links", async () => {
    const spent = await app().person();
    const spentClient = app().client();
    const spentLink = await askedFor(spentClient, spent.email);
    await spentClient.json("/sign-in/email-otp", { email: spent.email, otp: spentLink.code });
    const expired = await app().person();
    const expiredClient = app().client();
    const expiredLink = await askedFor(expiredClient, expired.email);
    await ageTheCode(expired.email);

    expect([
      await describedAs(app().client(), "a".repeat(43)),
      await describedAs(spentClient, spentLink.token),
      await describedAs(expiredClient, expiredLink.token),
    ]).toEqual([DEAD, DEAD, DEAD]);
  });

  it("answers no-store, so no cache keeps a code", async () => {
    const person = await app().person();
    const { token } = await askedFor(app().client(), person.email);

    const read = await describeLink(app().client(), token);

    expect(read.headers.get("cache-control")).toBe("no-store");
  });

  it("keeps its sign-in apart from the reads' ceiling", async () => {
    const person = await app().person();
    const asking = app().client();
    const { token } = await askedFor(asking, person.email);
    for (let read = 0; read < 11; read += 1) await describeLink(app().client(), token);

    expect((await asking.json(SIGN_IN_BY_LINK, { token })).status).toBe(200);
  });

  it("refuses one link's reads past its own ceiling", async () => {
    const person = await app().person();
    const { token } = await askedFor(app().client(), person.email);

    const answers: number[] = [];
    for (let read = 0; read < 11; read += 1) {
      answers.push((await describeLink(app().client(), token)).status);
    }

    expect(answers).toEqual([...Array.from({ length: 10 }, () => 200), 429]);
  });
});

describe("signing in through a link", () => {
  it("signs in the asking browser after a scanner opened it", async () => {
    const person = await app().person();
    const asking = app().client();
    const { token } = await askedFor(asking, person.email);
    const scanner = app().client();

    await scanner.fetch(LINK_PAGE, AS_A_PAGE);
    await scanner.fetch(LINK_PAGE, AS_A_PAGE);
    const signedIn = await asking.json(SIGN_IN_BY_LINK, { token });

    expect(signedIn.status).toBe(200);
    expect(await signedIn.json()).toEqual({ displayNameGiven: true, carried: "" });
    expect(await signedInAs(asking)).toBe(person.email.toLowerCase());
    expect(await signedInAs(scanner)).toBeUndefined();
  });

  it("refuses a browser without the binding cookie, signing nothing in", async () => {
    const person = await app().person();
    const asking = app().client();
    const { token } = await askedFor(asking, person.email);
    const phone = app().client();

    const refused = await phone.json(SIGN_IN_BY_LINK, { token });

    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "not-this-browser" });
    expect(await signedInAs(phone)).toBeUndefined();
    expect((await asking.json(SIGN_IN_BY_LINK, { token })).status).toBe(200);
  });

  it("refuses a browser bound to another address's link", async () => {
    const person = await app().person();
    const asking = app().client();
    const { token } = await askedFor(asking, person.email);
    const other = await app().person();
    const elsewhere = app().client();
    await askedFor(elsewhere, other.email);

    const refused = await elsewhere.json(SIGN_IN_BY_LINK, { token });

    expect(await describedAs(elsewhere, token)).toMatchObject({ state: "elsewhere" });
    expect(refused.status).toBe(403);
    expect(await signedInAs(elsewhere)).toBeUndefined();
  });

  it("dies once the code's three tries are spent", async () => {
    const person = await app().person();
    const asking = app().client();
    const { code, token } = await askedFor(asking, person.email);
    const wrong = code === "000000" ? "111111" : "000000";

    for (let tried = 0; tried < 3; tried += 1) {
      await asking.json("/sign-in/email-otp", { email: person.email, otp: wrong });
    }

    expect(await triesSpentOn(person.email)).toBe("3");
    expect(await describedAs(asking, token)).toEqual(DEAD);
  });

  it("answers a library failure as unanswered, not dead", async () => {
    const person = await app().person();
    const asking = app().client();
    const { token } = await askedFor(asking, person.email);

    const failed = await whileWritesAreRefused(app().database.superuser, "session", () =>
      asking.json(SIGN_IN_BY_LINK, { token }),
    );

    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ error: "unanswered" });
  });

  it("refuses a cross-site read or sign-in of a link", async () => {
    const person = await app().person();
    const { token } = await askedFor(app().client(), person.email);
    const crossSite = (path: string) =>
      app()
        .client()
        .fetch(path, {
          method: "POST",
          headers: { "content-type": "application/json", origin: "https://elsewhere.example" },
          body: JSON.stringify({ token }),
        });

    expect([(await crossSite(DESCRIBE)).status, (await crossSite(SIGN_IN_BY_LINK)).status]).toEqual(
      [403, 403],
    );
  });

  it("answers a malformed token as a dead link", async () => {
    const client = app().client();

    const answers = [
      await describedAs(client, "not a token!"),
      await (await client.json(DESCRIBE, { token: "a".repeat(129) })).json(),
      await (await client.json(DESCRIBE, {})).json(),
    ];

    expect(answers).toEqual([DEAD, DEAD, DEAD]);
    expect((await client.json(SIGN_IN_BY_LINK, { token: "not a token!" })).status).toBe(410);
  });

  it("dies, spending no tries, once its code is replaced", async () => {
    const { person, asking, token } = await aLinkAfterRewriting(
      "sign-in-otp-",
      "value = 'a-newer-code-hash:0'",
    );

    expect(await readAndSpent(asking, token)).toEqual(READS_DEAD);
    expect(await triesSpentOn(person.email)).toBe("0");
  });

  it("spends none of the code's tries on a wrong token", async () => {
    const person = await app().person();
    const asking = app().client();
    await askedFor(asking, person.email);

    for (let wrong = 0; wrong < 3; wrong += 1) {
      expect((await asking.json(SIGN_IN_BY_LINK, { token: `w${"x".repeat(42)}` })).status).toBe(
        410,
      );
    }

    expect(await triesSpentOn(person.email)).toBe("0");
  });

  it("kills the first link once a new code is sent", async () => {
    const person = await app().person();
    const asking = app().client();
    const first = await askedFor(asking, person.email);
    const second = await askedFor(asking, person.email);

    expect(await describedAs(asking, first.token)).toEqual(DEAD);
    expect((await asking.json(SIGN_IN_BY_LINK, { token: second.token })).status).toBe(200);
  });

  it("dies once its code is typed or it is used", async () => {
    const typed = await app().person();
    const typedClient = app().client();
    const typedLink = await askedFor(typedClient, typed.email);
    await typedClient.json("/sign-in/email-otp", { email: typed.email, otp: typedLink.code });
    const used = await app().person();
    const usedClient = app().client();
    const usedLink = await askedFor(usedClient, used.email);
    await usedClient.json(SIGN_IN_BY_LINK, { token: usedLink.token });

    const again = [
      await typedClient.json(SIGN_IN_BY_LINK, { token: typedLink.token }),
      await usedClient.json(SIGN_IN_BY_LINK, { token: usedLink.token }),
    ];

    expect(again.map((response) => response.status)).toEqual([410, 410]);
  });

  it("records its method, as a typed code records its own", async () => {
    const byLink = await app().person();
    const linkClient = app().client();
    const { token } = await askedFor(linkClient, byLink.email);
    await linkClient.json(SIGN_IN_BY_LINK, { token });
    const byCode = await app().person();
    const codeClient = app().client();
    const { code } = await askedFor(codeClient, byCode.email);
    await codeClient.json("/sign-in/email-otp", { email: byCode.email, otp: code });

    expect({
      link: await signInRowsOf(byLink.email),
      code: await signInRowsOf(byCode.email),
    }).toEqual({ link: [{ method: "email_link" }], code: [{ method: "email_code" }] });
  });

  it("resumes the connect-Claude flow the code request carried", async () => {
    const workspace = await app().provision();
    const asking = app().client();
    const started = await asking.fetch(
      `${PUBLIC_URL}${authorizeUrl({ challenge: pkce().challenge, scope: "knowledge:read" })}`,
      { redirect: "manual" },
    );
    const query = new URL(started.headers.get("location") ?? "", PUBLIC_URL).search;
    const { token } = await askedFor(asking, workspace.admin.email, {
      oauth_query: query.slice(1),
    });

    const read = await describedAs(asking, token);
    const signedIn = await asking.json(SIGN_IN_BY_LINK, { token });

    expect(read).toMatchObject({ state: "bound", carried: query });
    expect(signedIn.status).toBe(200);
    expect(await signedIn.json()).toMatchObject({ carried: query });
    const whilePending = await asking.json("/oauth2/continue", {
      postLogin: true,
      oauth_query: query.slice(1),
    });
    expect(whilePending.status, "an Admin's link sign-in confirms before consent").toBe(403);
    await confirmedByTheHarness(app(), asking);
    const next = await continueAfterPostLogin(asking, query);
    expect(`${next.origin}${next.pathname}`).toBe(`${PUBLIC_URL}/consent`);
  });

  it("returns where the sign-in page was asked to return", async () => {
    const person = await app().person();
    const asking = app().client();
    const { token } = await askedFor(asking, person.email, { redirect: "/invitations/01ABC" });

    const read = await describedAs(asking, token);
    const signedIn = await asking.json(SIGN_IN_BY_LINK, { token });

    expect(read).toMatchObject({ state: "bound", carried: "?redirect=%2Finvitations%2F01ABC" });
    expect(await signedIn.json()).toMatchObject({ carried: "?redirect=%2Finvitations%2F01ABC" });
  });

  it("drops a return path that leaves this origin", async () => {
    const person = await app().person();
    const asking = app().client();
    const { token } = await askedFor(asking, person.email, { redirect: "//elsewhere.example/x" });

    expect(await describedAs(asking, token)).toMatchObject({ state: "bound", carried: "" });
  });

  it.each([
    ["altered", "to_jsonb('A' || (value::jsonb ->> 'sealed'))"],
    ["cut short", `'"AAAA"'::jsonb`],
  ])("is dead when its sealed contents were %s", async (_how, sealedBecomes) => {
    const { asking, token } = await aLinkAfterRewriting(
      "sign-in-link-",
      `value = jsonb_set(value::jsonb, '{sealed}', ${sealedBecomes})::text`,
    );

    expect(await readAndSpent(asking, token)).toEqual(READS_DEAD);
  });
});

describe("the link page", () => {
  it("is served with no referrer and no caching", async () => {
    const page = await app().client().fetch(LINK_PAGE, AS_A_PAGE);

    expect(page.status).toBe(200);
    expect(page.headers.get("referrer-policy")).toBe("no-referrer");
    expect(page.headers.get("cache-control")).toBe("no-store");
  });

  it("serves a few reloads from one address", async () => {
    const client = app().client();

    const loads: number[] = [];
    for (let load = 0; load < 6; load += 1) {
      loads.push((await client.fetch(LINK_PAGE, AS_A_PAGE)).status);
    }

    expect(loads).toEqual([200, 200, 200, 200, 200, 200]);
  });

  it("leaves no link token in any log line", async () => {
    const person = await app().person();
    const asking = app().client();
    const { token } = await askedFor(asking, person.email);
    await describeLink(app().client(), token);
    await asking.json(SIGN_IN_BY_LINK, { token });

    expect(JSON.stringify(app().logs)).not.toContain(token);
  });
});
