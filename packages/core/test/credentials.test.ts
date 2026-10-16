import { inspect } from "node:util";

import { describe, expect, it, vi } from "vitest";

import { boundarySchemas, type ModelProvider } from "@better-answers/schema";

import { attempt } from "../src/kernel/index.ts";
import { openCredentials, openModelKeySetting, type Credentials } from "../src/llm/index.ts";
import { openPostgres, withIdentityRead, withScope } from "../src/store/postgres/index.ts";
import { setModelKey } from "../src/workspaces/index.ts";
import { bootstrap } from "./platform.ts";
import { postgresForSuite, seedingWith, whileWritesAreRefused } from "./suite-postgres.ts";

const db = postgresForSuite();

const ENVELOPE_KEY = Uint8Array.from({ length: 32 }, (_byte, index) => index);
const ANOTHER_ENVELOPE_KEY = Uint8Array.from({ length: 32 }, (_byte, index) => 255 - index);
const A_SHORT_ENVELOPE_KEY = Uint8Array.of(0xde, 0xad, 0xbe, 0xef, 0x99);

const A_KEY = "sk-test-u9-invented-key-0001";
const A_NEWER_KEY = "sk-test-u9-invented-key-0002";

const LONGEST_KEY = 1024;

const credentials = openCredentials(ENVELOPE_KEY);
const modelKeySetting = openModelKeySetting(ENVELOPE_KEY);

const door = () => openPostgres(db().runtimePool);

const aWorkspace = (): Promise<string> =>
  seedingWith(db().pool, async (seed) => (await seed.workspace()).id);

const setting = (workspaceId: string, key: string, provider = "anthropic") =>
  setModelKey(bootstrap, door(), modelKeySetting, { workspaceId, provider, key });

const keyReadIn = (
  scope: string,
  provider: ModelProvider = "anthropic",
  under: Credentials = credentials,
) => withScope(bootstrap, door(), scope, (tx) => under.readModelKey(tx, provider));

const revealedIn = async (workspaceId: string, provider: ModelProvider = "anthropic") => {
  const read = await keyReadIn(workspaceId, provider);
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

const shown = (value: unknown): string =>
  [
    JSON.stringify(value),
    inspect(value, { depth: null, showHidden: true }),
    String(value),
    value instanceof Error ? `${value.message}\n${value.stack ?? ""}` : "",
  ].join("\n");

const writtenOut = (bytes: Uint8Array): readonly string[] => {
  const held = Buffer.from(bytes);
  const hex = held.toString("hex");
  return [
    hex,
    hex.toUpperCase(),
    held.toString("base64"),
    [...bytes].join(","),
    [...bytes].join(", "),
    JSON.stringify(bytes),
  ];
};

const CONSOLE_METHODS = ["log", "info", "warn", "error", "debug"] as const;

const printedDuring = async (work: () => Promise<unknown>): Promise<string> => {
  const printed: string[] = [];
  const keep = (...parts: unknown[]): boolean => {
    printed.push(parts.map((part) => (typeof part === "string" ? part : shown(part))).join(" "));
    return true;
  };
  const watched = [
    vi.spyOn(process.stdout, "write").mockImplementation(keep),
    vi.spyOn(process.stderr, "write").mockImplementation(keep),
    ...CONSOLE_METHODS.map((method) => vi.spyOn(console, method).mockImplementation(keep)),
  ];
  try {
    await work();
  } finally {
    for (const spy of watched) spy.mockRestore();
  }
  return printed.join("\n");
};

const NOT_ONE_HEADER_VALUE = [
  ["an empty key", ""],
  ["a key of spaces", "   "],
  ["a key with a space in it", "sk-test u9"],
  ["a key over two lines", "sk-test-u9\nsk-test-u9"],
  ["a key with a letter outside ASCII", "sk-test-ü9"],
  ["a key longer than any provider issues", "k".repeat(LONGEST_KEY + 1)],
] as const;

describe("a workspace's model key", () => {
  it("reads a key back only inside its own workspace", async () => {
    const [holder, other] = [await aWorkspace(), await aWorkspace()];
    await setting(holder, A_KEY);

    const inItsOwn = await keyReadIn(holder);
    const inAnother = await keyReadIn(other);

    expect(inItsOwn.ok && inItsOwn.value?.reveal()).toBe(A_KEY);
    expect(inAnother).toEqual({ ok: true, value: undefined });
  });

  it("refuses a read outside any workspace's transaction", async () => {
    const workspaceId = await aWorkspace();
    await setting(workspaceId, A_KEY);

    const read = await attempt(() =>
      withIdentityRead(bootstrap, door(), (tx) => credentials.readModelKey(tx, "anthropic")),
    );

    expect(read.ok ? "answered" : read.error.message).toBe(
      "credentials: a model key is read inside its workspace's transaction",
    );
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

  it("keeps no key whose audit event was not written", async () => {
    const workspaceId = boundarySchemas.workspace.select.shape.id.parse(await aWorkspace());

    const stored = await attempt(() =>
      withScope(bootstrap, door(), workspaceId, (tx) =>
        modelKeySetting.storeModelKey(tx, { workspaceId, provider: "anthropic" }, A_KEY, () =>
          Promise.reject(new Error("the audit log refused the event")),
        ),
      ),
    );

    expect(stored.ok ? "stored" : stored.error.message).toBe("the audit log refused the event");
    expect(await rowsOf(workspaceId)).toEqual([]);
  });

  it("opens no row sealed under another envelope key", async () => {
    const workspaceId = await aWorkspace();
    await setting(workspaceId, A_KEY);

    const read = await keyReadIn(workspaceId, "anthropic", openCredentials(ANOTHER_ENVELOPE_KEY));

    expect(read).toEqual({ ok: false, error: "envelope-not-authentic" });
  });

  it("shows a stored key nowhere but the provider's read", async () => {
    const workspaceId = await aWorkspace();

    const set = await setting(workspaceId, A_KEY);
    const read = await keyReadIn(workspaceId);
    const rows = await rowsOf(workspaceId);
    const underAnother = await keyReadIn(
      workspaceId,
      "anthropic",
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

  it("prints neither key while setting and reading one", async () => {
    const workspaceId = await aWorkspace();
    let revealed: string | undefined;

    const printed = await printedDuring(async () => {
      await setting(workspaceId, A_KEY);
      revealed = await revealedIn(workspaceId);
    });
    const control = await printedDuring(async () => {
      process.stdout.write(`${A_KEY} ${String(ENVELOPE_KEY)}\n`);
    });

    expect(revealed, "a key was set and read while the process was watched").toBe(A_KEY);
    const secrets = [A_KEY, ...writtenOut(ENVELOPE_KEY)];
    expect(secrets.filter((secret) => printed.includes(secret))).toEqual([]);
    expect(
      secrets.filter((secret) => control.includes(secret)).length,
      "the watch sees a printed key",
    ).toBeGreaterThan(1);
  });

  it.each([
    ["opening to read", () => openCredentials(A_SHORT_ENVELOPE_KEY)],
    ["opening to set", () => openModelKeySetting(A_SHORT_ENVELOPE_KEY)],
  ])("%s names no byte of a short key", async (_side, open) => {
    const opened = await attempt(async () => open());

    expect(opened.ok ? "opened" : opened.error.message).toBe(
      "credentials: an envelope key is 32 bytes, not 5",
    );
    const thrown = shown(opened.ok ? undefined : opened.error);
    expect(writtenOut(A_SHORT_ENVELOPE_KEY).filter((form) => thrown.includes(form))).toEqual([]);
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

    expect(await keyReadIn(workspaceId)).toEqual({ ok: true, value: undefined });
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

  it("stores a key of exactly the longest length", async () => {
    const workspaceId = await aWorkspace();
    const longest = "k".repeat(LONGEST_KEY);

    const set = await setting(workspaceId, longest);

    expect(set.ok).toBe(true);
    expect(await revealedIn(workspaceId)).toBe(longest);
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

/** Invented: an account id is 32 hexadecimal digits, and the token follows its colon. */
const A_WORKERS_AI_KEY = "0123456789abcdef0123456789abcdef:invented_Token-u15";

const NOT_A_WORKERS_AI_KEY = [
  ["a token with no account id", "invented_Token-u15"],
  ["an account id with no token", "0123456789abcdef0123456789abcdef:"],
  ["an account id one digit short", "0123456789abcdef0123456789abcde:invented_Token-u15"],
  ["an account id in capitals", "0123456789ABCDEF0123456789ABCDEF:invented_Token-u15"],
  ["a token holding a second colon", "0123456789abcdef0123456789abcdef:invented:Token"],
  ["text before the account id", "x0123456789abcdef0123456789abcdef:invented"],
] as const;

describe("a Workers AI key", () => {
  it("stores an account id and a token as one key", async () => {
    const workspaceId = await aWorkspace();

    const set = await setting(workspaceId, A_WORKERS_AI_KEY, "cloudflare");

    expect(set).toEqual({ ok: true, value: { workspaceId, provider: "cloudflare" } });
    expect(await revealedIn(workspaceId, "cloudflare")).toBe(A_WORKERS_AI_KEY);
  });

  it.each(NOT_A_WORKERS_AI_KEY)("refuses %s, storing nothing", async (_case, key) => {
    const workspaceId = await aWorkspace();

    expect(await setting(workspaceId, key, "cloudflare")).toEqual({
      ok: false,
      error: "malformed",
    });
    expect(await rowsOf(workspaceId)).toEqual([]);
    expect(await eventsOf(workspaceId)).toEqual([]);
  });

  it("holds another provider's key to no such form", async () => {
    const workspaceId = await aWorkspace();

    expect((await setting(workspaceId, "invented_Token-u15", "anthropic")).ok).toBe(true);
  });
});
