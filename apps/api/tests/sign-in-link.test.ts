import { describe, expect, it } from "vitest";
import { z } from "zod";

import { authorizeUrl, continueAfterPostLogin, pkce } from "./flow.ts";
import { PUBLIC_URL, type TestClient } from "./harness.ts";
import { servedApp } from "./suite-app.ts";

const app = servedApp();

const LINK_PAGE = "/sign-in/link";
const DESCRIBE = "/sign-in-link/describe";
const SIGN_IN_BY_LINK = "/sign-in-link/sign-in";
const SEND_CODE = "/email-otp/send-verification-otp";
const BINDING_COOKIE = "__Host-better-answers.sign-in-link";

const DEAD = { state: "dead" };

const AS_A_PAGE = { headers: { accept: "text/html" } };

const sessionShape = z.object({ user: z.object({ email: z.string() }) }).nullable();

const signInRowsOf = async (email: string) =>
  (
    await app().database.superuser.query<{ detail: unknown }>(
      `SELECT e.detail FROM identity_audit_event e JOIN "user" u ON u.id = e.subject_id
        WHERE e.act = 'people.person.signed_in' AND u.email = $1`,
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

describe("the code request", () => {
  it("binds the browser that asked with a host-only cookie", async () => {
    const person = await app().person();

    const { asked } = await askedFor(app().client(), person.email);

    const [cookie] = asked.headers.getSetCookie();
    expect(cookie).toMatch(new RegExp(`^${BINDING_COOKIE}=[A-Za-z0-9_-]{43};`));
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
      carriedOn: null,
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

    expect(read).toMatchObject({ state: "bound", carriedOn: "connecting" });
    expect(signedIn.status).toBe(200);
    expect(await signedIn.json()).toMatchObject({ carried: query });
    const next = await continueAfterPostLogin(asking, query);
    expect(`${next.origin}${next.pathname}`).toBe(`${PUBLIC_URL}/consent`);
  });

  it("is dead when its sealed contents were altered", async () => {
    const person = await app().person();
    const asking = app().client();
    const { token } = await askedFor(asking, person.email);
    await app().database.superuser.query(
      `UPDATE verification
          SET value = jsonb_set(value::jsonb, '{sealed}', to_jsonb('A' || (value::jsonb ->> 'sealed')))::text
        WHERE identifier = $1`,
      [`sign-in-link-${person.email.toLowerCase()}`],
    );

    expect(await describedAs(asking, token)).toEqual(DEAD);
    expect((await asking.json(SIGN_IN_BY_LINK, { token })).status).toBe(410);
  });
});

describe("the link page", () => {
  it("is served with no referrer and no caching", async () => {
    const page = await app().client().fetch(LINK_PAGE, AS_A_PAGE);

    expect(page.status).toBe(200);
    expect(page.headers.get("referrer-policy")).toBe("no-referrer");
    expect(page.headers.get("cache-control")).toBe("no-store");
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
