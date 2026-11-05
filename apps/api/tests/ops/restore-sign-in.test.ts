import { describe, expect, it } from "vitest";
import { z } from "zod";

import { objectStoreForSuite } from "@better-answers/core/testing/objects";
import { matching } from "@better-answers/schema/testing/matching";

import type { Doors } from "../../src/doors.ts";
import type { EmailMessage, Mail } from "../../src/email/email.ts";
import type { OpsIo } from "../../src/ops/index.ts";
import { PUBLIC_URL } from "../support/harness/harness.ts";
import { opsRunner, type Run } from "../support/ops-run.ts";
import { aPersonHoldingEverything, signedInClient } from "../support/provoke.ts";
import { servedApp } from "../support/suite-app.ts";
import { webClientOf } from "../support/web-client.ts";

const objects = objectStoreForSuite();
const { help, opsWith } = opsRunner(objects);

describe("pnpm ops", () => {
  const served = servedApp();

  describe("restore-sign-in, for a person who lost every sign-in factor", () => {
    const NOTICE = "Your better-answers sign-in was restored";
    const RESTORE_CODE = /^[0-9a-hjkmnp-tv-z]{4}(?:-[0-9a-hjkmnp-tv-z]{4}){3}$/;
    const IDENTITY_ACTOR = "process:better-answers-identity";
    const RESTORED_AT = new Date("2026-10-03T09:00:00.000Z");
    const A_DAY_MS = 24 * 60 * 60_000;
    const sessionRead = z.object({ session: z.object({ id: z.string() }) });
    const CHECK_LINE =
      "restore-sign-in: run this only after you confirm who they are through a channel other than email. Give them the code through that same channel, never by email.";

    const capturingMail = (send?: Mail["send"]) => {
      const sent: EmailMessage[] = [];
      const mail: Mail = {
        send:
          send ??
          (async (message) => {
            sent.push(message);
          }),
        publicUrl: PUBLIC_URL,
      };
      return { sent, mail };
    };

    const restoring = (email: string, io: Partial<OpsIo> = {}, doors: Partial<Doors> = {}) =>
      opsWith(served(), ["restore-sign-in", "--email", email], {
        io: { mail: capturingMail().mail, ...io },
        doors,
      });

    const codeIn = (run: Run): string => {
      const said = run.lines.find((line) => line.startsWith("restore-sign-in: their restore code"));
      const code = said?.split(": ").at(-1);
      if (code === undefined)
        throw new Error(`no restore code was printed: ${run.lines.join("\n")}`);
      return code;
    };

    const factorsOf = async (personId: string) =>
      (
        await served().database.superuser.query<Record<string, unknown>>(
          `SELECT (SELECT count(*)::int FROM passkey WHERE user_id = u.id) AS passkeys,
                  (SELECT count(*)::int FROM authenticator WHERE user_id = u.id) AS authenticators,
                  (SELECT count(*)::int FROM recovery_code WHERE user_id = u.id) AS "recoveryCodes",
                  (SELECT count(*)::int FROM session WHERE user_id = u.id) AS sessions,
                  u.authenticator_enabled AS "authenticatorEnabled",
                  u.restore_required_at AS "restoreRequiredAt"
             FROM "user" u WHERE u.id = $1`,
          [personId],
        )
      ).rows[0];

    const identityRowsOf = async (personId: string) =>
      (
        await served().database.superuser.query<Record<string, unknown>>(
          "SELECT action, actor, detail FROM identity_audit_event WHERE subject_id = $1 ORDER BY at, id",
          [personId],
        )
      ).rows;

    const restoreRowsOf = async (email: string) =>
      (
        await served().database.superuser.query<{ value: string; expiresAt: Date }>(
          'SELECT value, expires_at AS "expiresAt" FROM verification WHERE identifier = $1',
          [`operator-restore-${email.toLowerCase()}`],
        )
      ).rows;

    it("removes the person's factors and codes and ends their sessions", async () => {
      const { person, client } = await aPersonHoldingEverything(served());
      const before = await factorsOf(person.id);

      const run = await restoring(person.email, {}, { clock: { now: () => RESTORED_AT } });

      expect(run.exitCode).toBe(0);
      expect(before).toEqual({
        passkeys: 1,
        authenticators: 1,
        recoveryCodes: 10,
        sessions: 2,
        authenticatorEnabled: true,
        restoreRequiredAt: null,
      });
      expect(await factorsOf(person.id)).toEqual({
        passkeys: 0,
        authenticators: 0,
        recoveryCodes: 0,
        sessions: 0,
        authenticatorEnabled: false,
        restoreRequiredAt: RESTORED_AT,
      });
      expect(await (await client.fetch("/get-session")).json()).toBeNull();
    });

    it("deletes the challenge rows of the sessions it ends", async () => {
      const { person, client } = await aPersonHoldingEverything(served());
      const { session } = sessionRead.parse(await (await client.fetch("/get-session")).json());
      const asked = await client.json("/second-factor/confirm/passkey-options", {});
      const challenge = `second-factor-challenge:${session.id}`;
      const kept = async () =>
        (
          await served().database.superuser.query<Record<string, unknown>>(
            "SELECT identifier FROM verification WHERE identifier = $1",
            [challenge],
          )
        ).rows;
      const before = await kept();

      await restoring(person.email);

      expect(asked.status).toBe(200);
      expect(before).toEqual([{ identifier: challenge }]);
      expect(await kept()).toEqual([]);
    });

    it("writes one identity audit event and sends one notice email", async () => {
      const person = await served().person();
      const before = await identityRowsOf(person.id);
      const { sent, mail } = capturingMail();

      const run = await restoring(person.email, { mail });

      expect(run.lines.slice(0, 2)).toEqual([
        `restore-sign-in: done — removed every passkey, authenticator and recovery code of ${person.email}, and signed out all their sessions`,
        `restore-sign-in: sent a notice of the restore to ${person.email}`,
      ]);
      expect((await identityRowsOf(person.id)).slice(before.length)).toEqual([
        { action: "people.person.sign_in_restored", actor: IDENTITY_ACTOR, detail: {} },
      ]);
      expect(sent.map((message) => [message.to, message.subject])).toEqual([
        [person.email, NOTICE],
      ]);
      expect(sent[0]?.text).toBe(
        [
          "Your sign-in was restored. Your passkeys, authenticator and recovery codes no longer work, and every session was signed out.",
          "",
          "If you asked for this, there is nothing more to do.",
          "",
          "If you didn't, tell better-answers support now:",
          "",
          `${PUBLIC_URL}/account`,
        ].join("\n"),
      );
      expect(sent[0]?.html).not.toContain("operator");
    });

    it("prints the code and says to check identity another way", async () => {
      const person = await served().person();

      const run = await restoring(person.email, {}, { clock: { now: () => RESTORED_AT } });

      expect(run.lines.slice(2)).toEqual([
        `restore-sign-in: their restore code, which works once until 2026-10-04T09:00:00.000Z: ${codeIn(run)}`,
        CHECK_LINE,
      ]);
      expect(codeIn(run)).toMatch(RESTORE_CODE);
    });

    it("refuses an unknown address and changes nothing", async () => {
      const { sent, mail } = capturingMail();

      const run = await restoring("nobody@acme.invalid", { mail });

      expect(run).toMatchObject({
        exitCode: 6,
        lines: [
          "restore-sign-in: REFUSED — no-such-user: no person has the email address nobody@acme.invalid. Nothing changed.",
        ],
      });
      expect(sent).toEqual([]);
      expect(await restoreRowsOf("nobody@acme.invalid")).toEqual([]);
    });

    it("refuses without an email transport and changes nothing", async () => {
      const { person } = await aPersonHoldingEverything(served());
      const before = await factorsOf(person.id);

      const run = await restoring(person.email, { mail: undefined });

      expect(run).toMatchObject({
        exitCode: 1,
        lines: [
          "restore-sign-in: REFUSED — SMTP_URL is not set on the api service, so the restore notice cannot be sent. Nothing changed.",
        ],
      });
      expect(await factorsOf(person.id)).toEqual(before);
      expect(await restoreRowsOf(person.email)).toEqual([]);
    });

    it("keeps the restore when the notice email fails to send", async () => {
      const person = await served().person();
      const { mail } = capturingMail(async () => {
        throw new Error("the relay refused the message");
      });

      const run = await restoring(person.email, { mail });

      expect(run.exitCode).toBe(0);
      expect(run.lines[1]).toBe(
        `restore-sign-in: the notice to ${person.email} could not be sent. Tell them about the restore yourself.`,
      );
      expect(codeIn(run)).toMatch(RESTORE_CODE);
      expect((await factorsOf(person.id))?.["restoreRequiredAt"]).not.toBeNull();
    });

    it("makes the next sign-in enter the code before adding factors", async () => {
      const { person } = await aPersonHoldingEverything(served());
      const code = codeIn(await restoring(person.email));
      const client = await signedInClient(served(), person.email);

      const held = await webClientOf(client).api.person.secondFactor.query();
      const adds = [
        await client.json("/authenticator/start", {}),
        await client.json("/passkeys/add-options", { name: "Phone" }),
      ];

      expect(held.restoreRequired).toBe(true);
      expect(adds.map((answer) => answer.status)).toEqual([409, 409]);
      for (const answer of adds) {
        expect(await answer.json()).toEqual({ error: "restore-code-needed" });
      }
      expect((await client.json("/second-factor/restore", { code })).status).toBe(200);
      expect((await client.json("/second-factor/replace/authenticator-start", {})).status).toBe(
        200,
      );
    });

    it("accepts the code once, whatever the case of the address", async () => {
      const person = await served().person();
      const code = codeIn(await restoring(person.email.toUpperCase()));
      const client = await signedInClient(served(), person.email);

      const first = await client.json("/second-factor/restore", { code });
      const again = await client.json("/second-factor/restore", { code });

      expect([first.status, again.status]).toEqual([200, 400]);
      expect(await again.json()).toEqual({ error: "restore-code-wrong" });
    });

    it("refuses the code after 24 hours", async () => {
      const restoredAgo = async (ageMs: number) => {
        const person = await served().person();
        const restoredAt = new Date(Date.now() - ageMs);
        const run = await restoring(person.email, {}, { clock: { now: () => restoredAt } });
        const client = await signedInClient(served(), person.email);
        return (await client.json("/second-factor/restore", { code: codeIn(run) })).status;
      };

      const statuses = [await restoredAgo(A_DAY_MS - 60_000), await restoredAgo(A_DAY_MS + 60_000)];

      expect(statuses).toEqual([200, 400]);
    });

    it("keeps the code out of every email and log line", async () => {
      const person = await served().person();
      const { sent, mail } = capturingMail();

      const run = await restoring(person.email, { mail });
      const code = codeIn(run);

      expect(sent).toHaveLength(1);
      expect(JSON.stringify(sent)).not.toContain(code);
      expect(JSON.stringify(run.logs)).not.toContain(code);
      expect(await restoreRowsOf(person.email)).toEqual([
        { value: matching.stringMatching(/^[0-9a-f]{64}$/), expiresAt: matching.any(Date) },
      ]);
    });

    it("invalidates the earlier restore code when restored again", async () => {
      const person = await served().person();
      const earlier = codeIn(await restoring(person.email));
      const later = codeIn(await restoring(person.email));
      const client = await signedInClient(served(), person.email);

      const statuses = [
        (await client.json("/second-factor/restore", { code: earlier })).status,
        (await client.json("/second-factor/restore", { code: later })).status,
      ];

      expect(statuses).toEqual([400, 200]);
      expect(await restoreRowsOf(person.email)).toEqual([]);
    });

    it("gives a usage error without --email and restores no one", async () => {
      const person = await served().person();

      const run = await opsWith(served(), ["restore-sign-in"], {
        io: { mail: capturingMail().mail },
      });

      expect(run).toMatchObject({
        exitCode: 2,
        lines: ["restore-sign-in: --email <email> is required"],
      });
      expect(await restoreRowsOf(person.email)).toEqual([]);
    });

    it("lists the command in the help text", async () => {
      expect(await help(served())).toContain("restore-sign-in --email <email>");
    });
  });
});
