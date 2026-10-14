import { inspect } from "node:util";

import { describe, expect, it } from "vitest";

import { boundarySchemas, type ModelProvider } from "@better-answers/schema";

import { openCredentials, type Credentials } from "../src/llm/index.ts";
import { openPostgres, withScope } from "../src/store/postgres/index.ts";
import { setModelKey } from "../src/workspaces/index.ts";
import { bootstrap } from "./platform.ts";
import { postgresForSuite, seedingWith, whileWritesAreRefused } from "./suite-postgres.ts";

const db = postgresForSuite();

/** Invented, as every key here is: they seal nothing outside this file. */
const ENVELOPE_KEY = Uint8Array.from({ length: 32 }, (_byte, index) => index);
const ANOTHER_ENVELOPE_KEY = Uint8Array.from({ length: 32 }, (_byte, index) => 255 - index);

const A_KEY = "sk-test-u9-invented-key-0001";
const A_NEWER_KEY = "sk-test-u9-invented-key-0002";

const credentials = openCredentials(ENVELOPE_KEY);

const door = () => openPostgres(db().runtimePool);

const aWorkspace = (): Promise<string> =>
  seedingWith(db().pool, async (seed) => (await seed.workspace()).id);

const setting = (
  workspaceId: string,
  key: string,
  provider = "anthropic",
  under: Credentials = credentials,
) => setModelKey(bootstrap, door(), under, { workspaceId, provider, key });

/** The key of `of`, asked for inside the scope of the workspace `scope`. */
const keyReadIn = (
  scope: string,
  of: { readonly workspaceId: string; readonly provider: ModelProvider },
  under: Credentials = credentials,
) =>
  withScope(bootstrap, door(), scope, (tx) =>
    under.readModelKey(tx, {
      workspaceId: boundarySchemas.workspace.select.shape.id.parse(of.workspaceId),
      provider: of.provider,
    }),
  );

const revealedIn = async (workspaceId: string, provider: ModelProvider = "anthropic") => {
  const read = await keyReadIn(workspaceId, { workspaceId, provider });
  return read.ok ? read.value?.reveal() : read.error;
};

const rowsOf = async (workspaceId: string) => {
  const stored = await db().pool.query<{ provider: string; sealed: Buffer }>(
    "SELECT provider, sealed FROM model_key WHERE workspace_id = $1 ORDER BY provider",
    [workspaceId],
  );
  return stored.rows;
};

/** The first frame `from` holds, written as the key of `onto`: what a writer past the provider could do. */
const frameCopied = async (
  from: string,
  onto: { readonly workspaceId: string; readonly provider: ModelProvider },
): Promise<void> => {
  const [held] = await rowsOf(from);
  if (held === undefined) throw new Error(`${from} holds no model key to copy`);
  await seedingWith(db().pool, (seed) =>
    seed.modelKey({ ...onto, sealed: new Uint8Array(held.sealed) }),
  );
};

const eventsOf = async (workspaceId: string) => {
  const audited = await db().pool.query(
    `SELECT action, family, actor, subject_kind, subject_id, detail, batch_id
       FROM audit_event WHERE workspace_id = $1 ORDER BY at, id`,
    [workspaceId],
  );
  return audited.rows;
};

/** Every way a value is put in front of a person: as JSON, as a logger prints it, as text. */
const shown = (value: unknown): string =>
  [
    JSON.stringify(value),
    inspect(value, { depth: null, showHidden: true }),
    String(value),
    value instanceof Error ? `${value.message}\n${value.stack ?? ""}` : "",
  ].join("\n");

const NOT_ONE_HEADER_VALUE = [
  ["an empty key", ""],
  ["a key of spaces", "   "],
  ["a key with a space in it", "sk-test u9"],
  ["a key over two lines", "sk-test-u9\nsk-test-u9"],
  ["a key with a letter outside ASCII", "sk-test-ü9"],
  ["a key longer than any provider issues", "k".repeat(1025)],
] as const;

describe("a workspace's model key", () => {
  it("reads a key back only inside its own workspace", async () => {
    const [holder, other] = [await aWorkspace(), await aWorkspace()];
    await setting(holder, A_KEY);

    const inItsOwn = await keyReadIn(holder, { workspaceId: holder, provider: "anthropic" });
    const fromAnother = await keyReadIn(other, { workspaceId: holder, provider: "anthropic" });

    expect(inItsOwn.ok && inItsOwn.value?.reveal()).toBe(A_KEY);
    expect(fromAnother).toEqual({ ok: true, value: undefined });
    expect(await revealedIn(other)).toBe(undefined);
  });

  it("writes one audit event naming the provider, never the key", async () => {
    const workspaceId = await aWorkspace();

    await setting(workspaceId, A_KEY);

    const events = await eventsOf(workspaceId);
    expect(events).toEqual([
      {
        action: "platform.workspace.model_key_set",
        family: "platform",
        actor: bootstrap.actorId,
        subject_kind: "workspace",
        subject_id: workspaceId,
        detail: { provider: "anthropic" },
        batch_id: null,
      },
    ]);
    expect(JSON.stringify(events)).not.toContain(A_KEY);
  });

  it("opens no row sealed under another envelope key", async () => {
    const workspaceId = await aWorkspace();
    await setting(workspaceId, A_KEY);

    const read = await keyReadIn(
      workspaceId,
      { workspaceId, provider: "anthropic" },
      openCredentials(ANOTHER_ENVELOPE_KEY),
    );

    expect(read).toEqual({ ok: false, error: "envelope-not-authentic" });
  });

  it("shows a stored key nowhere but the provider's read", async () => {
    const workspaceId = await aWorkspace();

    const set = await setting(workspaceId, A_KEY);
    const read = await keyReadIn(workspaceId, { workspaceId, provider: "anthropic" });
    const rows = await rowsOf(workspaceId);
    const underAnother = await keyReadIn(
      workspaceId,
      { workspaceId, provider: "anthropic" },
      openCredentials(ANOTHER_ENVELOPE_KEY),
    );
    const refused = await whileWritesAreRefused(db().pool, "model_key", () =>
      setting(workspaceId, A_NEWER_KEY),
    );

    expect(
      read.ok && read.value?.reveal(),
      "the key was stored, so its absence means something",
    ).toBe(A_KEY);
    expect(refused.ok, "the store's refusal reaches the caller as an error").toBe(false);
    const everythingElse = [
      shown(set),
      shown(read),
      shown(read.ok ? read.value : undefined),
      shown(underAnother),
      shown(refused),
      shown(refused.ok ? undefined : refused.error),
      shown(await eventsOf(workspaceId)),
      ...rows.map((row) => `${row.provider}\n${row.sealed.toString("latin1")}`),
    ].join("\n");
    expect(everythingElse).not.toContain(A_KEY);
    expect(everythingElse).not.toContain(A_NEWER_KEY);
  });

  it("leaves one current key when a key is set twice", async () => {
    const workspaceId = await aWorkspace();

    await setting(workspaceId, A_KEY);
    await setting(workspaceId, A_NEWER_KEY);

    expect(await rowsOf(workspaceId)).toHaveLength(1);
    expect(await revealedIn(workspaceId)).toBe(A_NEWER_KEY);
    expect((await eventsOf(workspaceId)).map((event) => event.action)).toEqual([
      "platform.workspace.model_key_set",
      "platform.workspace.model_key_set",
    ]);
  });

  it("reads a workspace with no key as none", async () => {
    const workspaceId = await aWorkspace();

    expect(await keyReadIn(workspaceId, { workspaceId, provider: "anthropic" })).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it("holds each model provider's key apart", async () => {
    const workspaceId = await aWorkspace();

    await setting(workspaceId, A_KEY, "anthropic");
    await setting(workspaceId, A_NEWER_KEY, "mistral");

    expect(await revealedIn(workspaceId, "anthropic")).toBe(A_KEY);
    expect(await revealedIn(workspaceId, "mistral")).toBe(A_NEWER_KEY);
  });

  it("opens no frame copied onto another workspace's row", async () => {
    const [holder, other] = [await aWorkspace(), await aWorkspace()];
    await setting(holder, A_KEY);

    await frameCopied(holder, { workspaceId: other, provider: "anthropic" });

    expect(await revealedIn(other)).toBe("envelope-not-authentic");
  });

  it("opens no frame copied onto another provider's row", async () => {
    const workspaceId = await aWorkspace();
    await setting(workspaceId, A_KEY, "anthropic");

    await frameCopied(workspaceId, { workspaceId, provider: "mistral" });

    expect(await revealedIn(workspaceId, "mistral")).toBe("envelope-not-authentic");
  });

  it.each(NOT_ONE_HEADER_VALUE)("refuses %s, storing nothing", async (_case, key) => {
    const workspaceId = await aWorkspace();

    const set = await setting(workspaceId, key);

    expect(set).toEqual({ ok: false, error: "malformed" });
    expect(await rowsOf(workspaceId)).toEqual([]);
    expect(await eventsOf(workspaceId)).toEqual([]);
  });

  it("refuses a model provider outside the closed set", async () => {
    const workspaceId = await aWorkspace();

    expect(await setting(workspaceId, A_KEY, "openai")).toEqual({ ok: false, error: "malformed" });
    expect(await rowsOf(workspaceId)).toEqual([]);
  });

  it("refuses a workspace that does not exist", async () => {
    const nowhere = "01J6ZZZZZZZZZZZZZZZZZZZZZZ";

    expect(await setting(nowhere, A_KEY)).toEqual({ ok: false, error: "no-such-workspace" });
    expect(await rowsOf(nowhere)).toEqual([]);
  });

  it("answers the workspace and model provider it set", async () => {
    const workspaceId = await aWorkspace();

    expect(await setting(workspaceId, A_KEY, "mistral")).toEqual({
      ok: true,
      value: { workspaceId, provider: "mistral" },
    });
  });
});
