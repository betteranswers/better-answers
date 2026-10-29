import { Pool } from "pg";
import { assert, describe, expect, it } from "vitest";
import { z } from "zod";

import { STORED_DETAIL_KEYS } from "@better-answers/core/audit";
import { openPostgres } from "@better-answers/core/store/postgres";
import { objectStoreForSuite } from "@better-answers/core/testing/objects";
import { ulid } from "@better-answers/schema";
import { matching } from "@better-answers/schema/testing/matching";

import { signIn } from "../support/flow.ts";
import type { TestApp } from "../support/harness/harness.ts";
import {
  opsRunner,
  type Run,
  BOOTSTRAP_ACTOR,
  idOnTheDoneLine,
  aShortName,
  rowsOfAction,
  auditLogOf,
} from "../support/ops-run.ts";
import { servedApp } from "../support/suite-app.ts";

const objects = objectStoreForSuite();
const { ops, opsWith, provisioning, adding } = opsRunner(objects);

const ULID_SHAPE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

const membersOf = async (app: TestApp, workspaceId: string, userId: string) => {
  const found = await app.database.superuser.query<{ id: string; role: string }>(
    "SELECT id, role FROM member WHERE workspace_id = $1 AND user_id = $2",
    [workspaceId, userId],
  );
  return found.rows;
};

const workspaceCountOf = async (app: TestApp, userId: string): Promise<number> => {
  const found = await app.database.superuser.query("SELECT 1 FROM member WHERE user_id = $1", [
    userId,
  ]);
  return found.rowCount ?? 0;
};

const workspacesWithShortName = async (app: TestApp, shortName: string): Promise<number> => {
  const found = await app.database.superuser.query(
    "SELECT 1 FROM workspace WHERE short_name = $1",
    [shortName],
  );
  return found.rowCount ?? 0;
};

describe("pnpm ops — the restore scripts' commands", () => {
  const served = servedApp();

  describe("provision-workspace — a customer's workspace and its first Admin", () => {
    const standingOf = async (app: TestApp, id: string) => {
      const found = await app.database.superuser.query<Record<string, unknown>>(
        `SELECT w.name, w.short_name AS "shortName",
                EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                         WHERE n.nspname = 'index' AND c.relname = 'passage_' || w.id) AS partition,
                (SELECT value FROM workspace_config
                  WHERE workspace_id = w.id AND key = 'mcp.tools_list_ttl_ms') AS ttl
           FROM workspace w WHERE w.id = $1`,
        [id],
      );
      return found.rows;
    };

    it("stands up workspace, partition, member, config, audit log and repository", async () => {
      const admin = await served().person(undefined, "Priya Shah");
      const shortName = aShortName();

      const run = await provisioning(served(), [
        "--name",
        "Acme",
        "--short-name",
        shortName,
        "--admin",
        admin.email,
      ]);

      expect(run.exitCode).toBe(0);
      const id = idOnTheDoneLine(run);
      expect(run.lines).toEqual([
        `provision-workspace: done — ${id}, short name ${shortName}, Admin ${admin.email}`,
      ]);
      expect(await standingOf(served(), id)).toEqual([
        { name: "Acme", shortName, partition: true, ttl: "300000" },
      ]);
      expect(await membersOf(served(), id, admin.id)).toEqual([
        { id: matching.stringMatching(ULID_SHAPE), role: "Admin" },
      ]);
      expect(await rowsOfAction(served(), id, "platform.workspace.provisioned")).toEqual([
        {
          actor: BOOTSTRAP_ACTOR,
          subject_id: id,
          detail: { adminUserId: admin.id, role: "Admin" },
        },
      ]);
      const reconciled = await ops(served(), ["reconcile-watermark", "--workspace", id]);
      expect(reconciled.lines).toEqual([
        "reconcile-watermark: done — head none, watermark none, replayed 0, already landed 0",
      ]);
    });

    it("resolves the Admin's email regardless of case, as sign-in does", async () => {
      const admin = await served().person("Priya.Shah@Acme.Invalid");

      const run = await provisioning(served(), [
        "--name",
        "Acme",
        "--short-name",
        aShortName(),
        "--admin",
        "priya.shah@acme.invalid",
      ]);

      expect(run.exitCode).toBe(0);
      expect(await membersOf(served(), idOnTheDoneLine(run), admin.id)).toEqual([
        { id: matching.stringMatching(ULID_SHAPE), role: "Admin" },
      ]);
    });

    it("refuses no-such-user, says what to do next, writes nothing", async () => {
      const shortName = aShortName();

      const run = await provisioning(served(), [
        "--name",
        "Acme",
        "--short-name",
        shortName,
        "--admin",
        "nobody@acme.invalid",
      ]);

      expect(run.exitCode).toBe(6);
      expect(run.lines).toEqual([
        "provision-workspace: REFUSED — no-such-user: nobody@acme.invalid has not signed in; have them sign in with an email code first, or add them with add-person, then run this again",
      ]);
      expect(await workspacesWithShortName(served(), shortName)).toBe(0);
    });

    it("refuses no-display-name, says what to do next, writes nothing", async () => {
      const admin = await served().person(undefined, "");
      const shortName = aShortName();

      const run = await provisioning(served(), [
        "--name",
        "Acme",
        "--short-name",
        shortName,
        "--admin",
        admin.email,
      ]);

      expect(run.exitCode).toBe(9);
      expect(run.lines).toEqual([
        `provision-workspace: REFUSED — no-display-name: ${admin.email} has given no display name; have them sign in and give one, then run this again`,
      ]);
      expect(await workspacesWithShortName(served(), shortName)).toBe(0);
      expect(await workspaceCountOf(served(), admin.id)).toBe(0);
    });

    it("refuses slug-taken for a held short name, writing nothing", async () => {
      const first = await served().person();
      const second = await served().person();
      const shortName = aShortName();
      const held = await provisioning(served(), [
        "--name",
        "One",
        "--short-name",
        shortName,
        "--admin",
        first.email,
      ]);
      expect(held.exitCode).toBe(0);

      const run = await provisioning(served(), [
        "--name",
        "Two",
        "--short-name",
        shortName,
        "--admin",
        second.email,
      ]);

      expect(run.exitCode).toBe(8);
      expect(run.lines).toEqual([
        `provision-workspace: REFUSED — slug-taken: another workspace already holds the short name ${shortName}`,
      ]);
      expect(await workspacesWithShortName(served(), shortName)).toBe(1);
      expect(await workspaceCountOf(served(), second.id)).toBe(0);
    });

    it("refuses malformed for a blank name or short name", async () => {
      const admin = await served().person();

      const run = await provisioning(served(), [
        "--name",
        "   ",
        "--short-name",
        aShortName(),
        "--admin",
        admin.email,
      ]);

      expect(run.exitCode).toBe(2);
      expect(run.lines).toEqual([
        "provision-workspace: REFUSED — malformed: the name and the short name must each carry at least one character",
      ]);
      expect(await workspaceCountOf(served(), admin.id)).toBe(0);
    });

    it("refuses without a repositories' root, before writing anything", async () => {
      const admin = await served().person();
      const shortName = aShortName();

      const run = await opsWith(
        served(),
        [
          "provision-workspace",
          "--name",
          "Acme",
          "--short-name",
          shortName,
          "--admin",
          admin.email,
        ],
        { doors: { git: undefined } },
      );

      expect(run.exitCode).toBe(1);
      expect(run.lines.join("\n")).toContain("GIT_STORE_DIR");
      expect(await workspacesWithShortName(served(), shortName)).toBe(0);
    });

    it("answers usage to a missing --name, writing nothing", async () => {
      const admin = await served().person();
      const shortName = aShortName();

      const run = await provisioning(served(), ["--short-name", shortName, "--admin", admin.email]);

      expect(run.exitCode).toBe(2);
      expect(run.lines).toEqual([
        "provision-workspace: --name <name>, --short-name <short name> and --admin <email> are required",
      ]);
      expect(await workspacesWithShortName(served(), shortName)).toBe(0);
      expect(await workspaceCountOf(served(), admin.id)).toBe(0);
    });

    it("names both commands in the usage", async () => {
      const run = await ops(served(), ["help"]);

      expect(run.lines.join("\n")).toContain(
        "provision-workspace --name <name> --short-name <short name> --admin <email>",
      );
      expect(run.lines.join("\n")).toContain(
        "add-member --workspace <id> --email <email> --role <Admin|Editor|Viewer>",
      );
    });
  });

  describe("add-member — a signed-in person made a workspace's member", () => {
    it.each(["Admin", "Editor", "Viewer"])(
      "makes a person a %s member, with audit events",
      async (role) => {
        const { workspaceId } = await served().provision();
        const person = await served().person();

        const run = await adding(served(), workspaceId, person.email, role);

        expect(run.exitCode).toBe(0);
        expect(run.lines).toEqual([
          `add-member: done — ${person.email} added to workspace ${workspaceId} as ${role}`,
        ]);
        expect(await membersOf(served(), workspaceId, person.id)).toEqual([
          { id: matching.stringMatching(ULID_SHAPE), role },
        ]);
        expect(await rowsOfAction(served(), workspaceId, "people.member.added")).toEqual([
          { actor: BOOTSTRAP_ACTOR, subject_id: person.id, detail: { userId: person.id, role } },
        ]);
      },
    );

    it("resolves the email without regard to case, as sign-in does", async () => {
      const { workspaceId } = await served().provision();
      const person = await served().person("Sam.Okoro@Acme.Invalid");

      const run = await adding(served(), workspaceId, "sam.okoro@acme.invalid", "Viewer");

      expect(run.exitCode).toBe(0);
      expect(await membersOf(served(), workspaceId, person.id)).toEqual([
        { id: matching.stringMatching(ULID_SHAPE), role: "Viewer" },
      ]);
    });

    it("refuses no-such-user, says what to do next, writes nothing", async () => {
      const { workspaceId } = await served().provision();

      const run = await adding(served(), workspaceId, "nobody@acme.invalid", "Editor");

      expect(run.exitCode).toBe(6);
      expect(run.lines).toEqual([
        "add-member: REFUSED — no-such-user: nobody@acme.invalid has not signed in; have them sign in with an email code first, or add them with add-person, then run this again",
      ]);
      expect(await rowsOfAction(served(), workspaceId, "people.member.added")).toEqual([]);
    });

    it("refuses no-display-name, says what to do next, writes nothing", async () => {
      const { workspaceId } = await served().provision();
      const person = await served().person(undefined, "");

      const run = await adding(served(), workspaceId, person.email, "Editor");

      expect(run.exitCode).toBe(9);
      expect(run.lines).toEqual([
        `add-member: REFUSED — no-display-name: ${person.email} has given no display name; have them sign in and give one, then run this again`,
      ]);
      expect(await workspaceCountOf(served(), person.id)).toBe(0);
      expect(await rowsOfAction(served(), workspaceId, "people.member.added")).toEqual([]);
    });

    it("refuses no-such-workspace for an unknown id, and writes nothing", async () => {
      const person = await served().person();
      const nowhere = ulid();

      const run = await adding(served(), nowhere, person.email, "Editor");

      expect(run.exitCode).toBe(6);
      expect(run.lines).toEqual([
        `add-member: REFUSED — no-such-workspace: ${nowhere} is not a workspace`,
      ]);
      expect(await workspaceCountOf(served(), person.id)).toBe(0);
      expect(await auditLogOf(served(), nowhere)).toEqual([]);
    });

    it("refuses already-a-member on any repeat, never changing a role", async () => {
      const { workspaceId, admin } = await served().provision();
      const person = await served().person();
      expect((await adding(served(), workspaceId, person.email, "Editor")).exitCode).toBe(0);

      const again = await adding(served(), workspaceId, person.email, "Admin");
      const theAdmin = await adding(served(), workspaceId, admin.email, "Viewer");

      expect([again.exitCode, theAdmin.exitCode]).toEqual([8, 8]);
      expect(again.lines).toEqual([
        `add-member: REFUSED — already-a-member: ${person.email} is already a member of workspace ${workspaceId}; a role change is the Admin's action on the People page`,
      ]);
      expect((await membersOf(served(), workspaceId, person.id)).map((row) => row.role)).toEqual([
        "Editor",
      ]);
      expect((await membersOf(served(), workspaceId, admin.id)).map((row) => row.role)).toEqual([
        "Admin",
      ]);
      expect(await rowsOfAction(served(), workspaceId, "people.member.added")).toHaveLength(1);
    });

    it("answers usage to a fourth role word, and writes nothing", async () => {
      const { workspaceId } = await served().provision();
      const person = await served().person();

      const run = await adding(served(), workspaceId, person.email, "Owner");

      expect(run.exitCode).toBe(2);
      expect(run.lines).toEqual(["add-member: --role must be one of Admin, Editor, Viewer"]);
      expect(await membersOf(served(), workspaceId, person.id)).toEqual([]);
    });

    it("answers usage to a non-id workspace", async () => {
      const run = await ops(served(), [
        "add-member",
        "--workspace",
        "ws_synthetic",
        "--email",
        "a@b.c",
        "--role",
        "Editor",
      ]);

      expect(run.exitCode).toBe(2);
      expect(run.lines).toEqual([
        "add-member: REFUSED — malformed: --workspace ws_synthetic is not a workspace id",
      ]);
    });
  });

  describe("add-person — a named person before their first sign-in", () => {
    const addingPerson = (app: TestApp, flags: readonly string[]): Promise<Run> =>
      opsWith(app, ["add-person", ...flags], {});

    const personsAt = async (app: TestApp, email: string) => {
      const found = await app.database.superuser.query<{
        id: string;
        name: string;
        email: string;
        email_verified: boolean;
      }>('SELECT id, name, email, email_verified FROM "user" WHERE lower(email) = lower($1)', [
        email,
      ]);
      return found.rows;
    };

    const addedRowsAbout = async (app: TestApp, personId: string) => {
      const found = await app.database.superuser.query<Record<string, unknown>>(
        `SELECT actor, subject_id, detail FROM identity_audit_event
          WHERE subject_id = $1 AND action = 'people.person.added'`,
        [personId],
      );
      return found.rows;
    };

    const addedRowCount = async (app: TestApp): Promise<number> => {
      const found = await app.database.superuser.query<{ rows: number }>(
        "SELECT count(*)::int AS rows FROM identity_audit_event WHERE action = 'people.person.added'",
      );
      return found.rows[0]?.rows ?? 0;
    };

    const aVerifier = (): string => `matthew-${ulid().toLowerCase()}@phew.invalid`;

    const sessionHolder = z.object({
      user: z.object({ id: z.string(), name: z.string(), emailVerified: z.boolean() }),
    });

    it("writes the person and its row, its id first", async () => {
      const email = aVerifier();

      const run = await addingPerson(served(), [
        "--email",
        email.toUpperCase(),
        "--name",
        "Matthew Burgess",
      ]);

      expect(run.exitCode).toBe(0);
      const personId = idOnTheDoneLine(run);
      expect(run.lines).toEqual([
        `add-person: done — ${personId}, ${email}, named Matthew Burgess; unverified until their first email-code sign-in`,
      ]);
      expect(await personsAt(served(), email)).toEqual([
        { id: personId, name: "Matthew Burgess", email, email_verified: false },
      ]);
      expect(await addedRowsAbout(served(), personId)).toEqual([
        { actor: "process:better-answers-identity", subject_id: personId, detail: {} },
      ]);
    });

    it("lets add-member take them, and their sign-in finds them", async () => {
      const { workspaceId } = await served().provision();
      const email = aVerifier();
      const added = await addingPerson(served(), ["--email", email, "--name", "Matthew Burgess"]);
      const personId = idOnTheDoneLine(added);

      const member = await adding(served(), workspaceId, email, "Admin");
      const client = served().client();
      await signIn(served(), client, email);

      expect(member.exitCode).toBe(0);
      expect(await membersOf(served(), workspaceId, personId)).toEqual([
        { id: matching.stringMatching(ULID_SHAPE), role: "Admin" },
      ]);
      const session = sessionHolder.parse(await (await client.fetch("/get-session")).json());
      expect(session.user).toEqual({ id: personId, name: "Matthew Burgess", emailVerified: true });
      expect(await personsAt(served(), email)).toEqual([
        { id: personId, name: "Matthew Burgess", email, email_verified: true },
      ]);
    });

    it.each([
      [
        "a non-address",
        ["--email", "matthew.phew.invalid", "--name", "Matthew Burgess"],
        "malformed: matthew.phew.invalid is not an email address",
      ],
      [
        "a two-line name",
        ["--email", "matthew@phew.invalid", "--name", "Matthew\nBurgess"],
        "display-name-not-one-line: a display name is one line of 1 to 100 characters, with no angle brackets or control characters",
      ],
      [
        "an angle-bracketed name",
        ["--email", "matthew@phew.invalid", "--name", "Matthew <m@phew.invalid>"],
        "display-name-angle-bracket: a display name is one line of 1 to 100 characters, with no angle brackets or control characters",
      ],
    ])("refuses %s in the malformed class, writing nothing", async (_shape, flags, said) => {
      const before = await addedRowCount(served());

      const run = await addingPerson(served(), flags);

      expect(run).toMatchObject({ exitCode: 2, lines: [`add-person: REFUSED — ${said}`] });
      const [, email] = flags;
      assert(email !== undefined, "the flags name an address");
      expect(await personsAt(served(), email)).toEqual([]);
      expect(await addedRowCount(served())).toBe(before);
    });

    it("refuses person-exists on a repeat or a signed-in address", async () => {
      const email = aVerifier();
      await addingPerson(served(), ["--email", email, "--name", "Matthew Burgess"]);
      const signedIn = await served().person(undefined, "Priya Shah");
      const before = await addedRowCount(served());

      const again = await addingPerson(served(), ["--email", email, "--name", "Matt Burgess"]);
      const held = await addingPerson(served(), [
        "--email",
        signedIn.email.toUpperCase(),
        "--name",
        "Someone Else",
      ]);

      expect([again.exitCode, held.exitCode]).toEqual([8, 8]);
      expect([...again.lines, ...held.lines]).toEqual([
        `add-person: REFUSED — person-exists: ${email} is already a person; add-member takes them as they stand`,
        `add-person: REFUSED — person-exists: ${signedIn.email.toUpperCase()} is already a person; add-member takes them as they stand`,
      ]);
      expect((await personsAt(served(), email)).map((row) => row.name)).toEqual([
        "Matthew Burgess",
      ]);
      expect((await personsAt(served(), signedIn.email)).map((row) => row.name)).toEqual([
        "Priya Shah",
      ]);
      expect(await addedRowCount(served())).toBe(before);
    });

    it("exits refused, in no word, when the store is unreachable", async () => {
      const gone = new Pool({ connectionString: served().database.connectionUri, max: 1 });
      await gone.end();

      const run = await opsWith(
        served(),
        ["add-person", "--email", aVerifier(), "--name", "Matthew Burgess"],
        { doors: { postgres: openPostgres(gone) } },
      );

      expect(run.exitCode).toBe(1);
      expect(run.lines).toEqual([matching.stringMatching(/^add-person: REFUSED — .*pool/i)]);
    });

    it("answers usage to a missing --name, writing nothing", async () => {
      const email = aVerifier();
      const before = await addedRowCount(served());

      const run = await addingPerson(served(), ["--email", email]);

      expect(run).toMatchObject({
        exitCode: 2,
        lines: ["add-person: --email <address> and --name <display name> are required"],
      });
      expect(await personsAt(served(), email)).toEqual([]);
      expect(await addedRowCount(served())).toBe(before);
    });

    it("names the command in the usage", async () => {
      const run = await ops(served(), ["help"]);

      expect(run.lines.join("\n")).toContain("add-person --email <address> --name <display name>");
    });
  });

  describe("rename-workspace — the platform renames a workspace", () => {
    const renaming = (app: TestApp, workspaceId: string, flags: readonly string[]): Promise<Run> =>
      opsWith(app, ["rename-workspace", "--workspace", workspaceId, ...flags], {});

    const outcomeOf = async (app: TestApp, workspaceId: string) => {
      const standing = await app.database.superuser.query<{ name: string; shortName: string }>(
        'SELECT name, short_name AS "shortName" FROM workspace WHERE id = $1',
        [workspaceId],
      );
      return {
        standing: standing.rows,
        renamed: await rowsOfAction(app, workspaceId, "platform.workspace.renamed"),
      };
    };

    const renamedEvent = (
      workspaceId: string,
      detail: {
        readonly nameChanged: boolean;
        readonly [STORED_DETAIL_KEYS.shortNameChanged]: boolean;
      },
    ) => ({ actor: BOOTSTRAP_ACTOR, subject_id: workspaceId, detail });

    const MALFORMED =
      "rename-workspace: REFUSED — malformed: give --workspace a workspace id, and --name, --short-name or both a value that is not blank";

    it("renames the name, short name or both, recording each change", async () => {
      const { workspaceId, shortName } = await served().provision({ name: "Acme" });
      const [first, second] = [aShortName(), aShortName()];

      const runs = [
        await renaming(served(), workspaceId, ["--name", "Acme Group"]),
        await renaming(served(), workspaceId, ["--short-name", first]),
        await renaming(served(), workspaceId, ["--name", "Acme Ltd", "--short-name", second]),
      ];

      expect(runs.map((run) => run.exitCode)).toEqual([0, 0, 0]);
      expect(runs.map((run) => run.lines)).toEqual([
        [
          `rename-workspace: done — workspace ${workspaceId} is named Acme Group, short name ${shortName}`,
        ],
        [
          `rename-workspace: done — workspace ${workspaceId} is named Acme Group, short name ${first}`,
        ],
        [
          `rename-workspace: done — workspace ${workspaceId} is named Acme Ltd, short name ${second}`,
        ],
      ]);
      expect(await outcomeOf(served(), workspaceId)).toEqual({
        standing: [{ name: "Acme Ltd", shortName: second }],
        renamed: [
          renamedEvent(workspaceId, {
            nameChanged: true,
            [STORED_DETAIL_KEYS.shortNameChanged]: false,
          }),
          renamedEvent(workspaceId, {
            nameChanged: false,
            [STORED_DETAIL_KEYS.shortNameChanged]: true,
          }),
          renamedEvent(workspaceId, {
            nameChanged: true,
            [STORED_DETAIL_KEYS.shortNameChanged]: true,
          }),
        ],
      });
    });

    it("takes back its own short name without refusing, writing nothing", async () => {
      const { workspaceId, shortName } = await served().provision({ name: "Acme" });

      const run = await renaming(served(), workspaceId, [
        "--name",
        "Acme",
        "--short-name",
        shortName,
      ]);

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual([
        `rename-workspace: done — workspace ${workspaceId} is named Acme, short name ${shortName}`,
      ]);
      expect(await outcomeOf(served(), workspaceId)).toEqual({
        standing: [{ name: "Acme", shortName }],
        renamed: [],
      });
    });

    it("refuses slug-taken for another workspace's short name", async () => {
      const taken = (await served().provision()).shortName;
      const { workspaceId, shortName } = await served().provision({ name: "Acme" });

      const run = await renaming(served(), workspaceId, [
        "--name",
        "Acme Group",
        "--short-name",
        taken,
      ]);

      expect(run.exitCode).toBe(8);
      expect(run.lines).toEqual([
        "rename-workspace: REFUSED — slug-taken: another workspace already holds that short name",
      ]);
      expect(await outcomeOf(served(), workspaceId)).toEqual({
        standing: [{ name: "Acme", shortName }],
        renamed: [],
      });
    });

    it("refuses no-such-workspace for an unknown id, and writes nothing", async () => {
      const nowhere = ulid();

      const run = await renaming(served(), nowhere, ["--name", "Acme Group"]);

      expect(run.exitCode).toBe(6);
      expect(run.lines).toEqual([
        `rename-workspace: REFUSED — no-such-workspace: ${nowhere} is not a workspace`,
      ]);
      expect(await auditLogOf(served(), nowhere)).toEqual([]);
    });

    it.each([
      ["a blank name", ["--name", "   "]],
      ["a blank short name", ["--name", "Acme Group", "--short-name", " "]],
      ["neither --name nor --short-name", []],
    ])("refuses malformed for %s, changing nothing", async (_shape, flags) => {
      const { workspaceId, shortName } = await served().provision({ name: "Acme" });

      const run = await renaming(served(), workspaceId, flags);

      expect({ exitCode: run.exitCode, lines: run.lines }).toEqual({
        exitCode: 2,
        lines: [MALFORMED],
      });
      expect(await outcomeOf(served(), workspaceId)).toEqual({
        standing: [{ name: "Acme", shortName }],
        renamed: [],
      });
    });

    it("refuses malformed for a workspace that is not an id", async () => {
      const run = await renaming(served(), "ws_synthetic", ["--name", "Acme Group"]);

      expect({ exitCode: run.exitCode, lines: run.lines }).toEqual({
        exitCode: 2,
        lines: [MALFORMED],
      });
    });

    it("names the command in the usage", async () => {
      const run = await ops(served(), ["help"]);

      expect(run.lines.join("\n")).toContain(
        "rename-workspace --workspace <id> [--name <name>] [--short-name <short name>]",
      );
    });
  });
});
