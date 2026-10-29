import { err, ok, type Result } from "@better-answers/core/kernel";

import { DONE, REFUSED, type OpsIo, type Flags, flagValue } from "./cli.ts";

const BY_HAND = ["find", "guide", "ask"] as const;

type SmokeAsked = {
  readonly url: string;
  readonly byHand: readonly (typeof BY_HAND)[number][];
};

export const smokeAskedOf = (flags: Flags): Result<SmokeAsked, string> => {
  const url = flagValue(flags, "url");
  return url === undefined
    ? err("--url <origin> is required (http://127.0.0.1:3000 inside the stack)")
    : ok({ url, byHand: BY_HAND.filter((entry) => flags.get(entry) === true) });
};

export const smoke = async ({ url, byHand }: SmokeAsked, io: OpsIo): Promise<number> => {
  const origin = url.replace(/\/$/u, "");

  const asApp: RequestInit =
    io.appHostname === undefined ? {} : { headers: { host: io.appHostname } };
  let failed = 0;
  const check = async (
    name: string,
    request: () => Promise<Response>,
    expect: (response: Response) => Promise<boolean>,
  ): Promise<void> => {
    try {
      const response = await request();
      const passed = await expect(response);
      io.say(`${passed ? "ok  " : "FAIL"} ${name} → ${response.status}`);
      if (!passed) failed += 1;
    } catch (cause) {
      io.say(`FAIL ${name} → ${cause instanceof Error ? cause.message : String(cause)}`);
      failed += 1;
    }
  };

  await check(
    "/health answers healthy",
    () => io.fetch(`${origin}/health`),
    async (response) => response.status === 200,
  );
  await check(
    "/.well-known/oauth-protected-resource/mcp names the MCP surface",
    () => io.fetch(`${origin}/.well-known/oauth-protected-resource/mcp`, asApp),
    async (response) => {
      if (response.status !== 200) return false;
      const document: unknown = await response.json();
      return (
        typeof document === "object" &&
        document !== null &&
        "resource" in document &&
        typeof document.resource === "string" &&
        document.resource.endsWith("/mcp")
      );
    },
  );
  await check(
    "/mcp without a bearer is refused with a challenge",
    () => io.fetch(`${origin}/mcp`, { ...asApp, method: "POST" }),
    async (response) =>
      response.status === 401 && (response.headers.get("www-authenticate") ?? "") !== "",
  );
  await check(
    "/ serves the shell",
    () => io.fetch(`${origin}/`, asApp),
    async (response) =>
      response.status === 200 && (response.headers.get("content-type") ?? "").includes("text/html"),
  );
  for (const entry of byHand) {
    io.say(`note ${entry}: needs a minted token — proved by hand through the connector, not here`);
  }
  return failed === 0 ? DONE : REFUSED;
};

const OUTSIDE_ANY_SECTION = "";

const SECTION_OPENS = /^COPY\s+([^\s(]+)/u;

const maskToken = (token: string): string =>
  token.length > 8 ? `${token.slice(0, 4)}…${token.slice(-2)}` : token;

type ScannedLine = { readonly table: string | undefined; readonly countable: boolean };

const scanLine = (table: string | undefined, line: string): ScannedLine => {
  if (table === undefined) {
    const opened = SECTION_OPENS.exec(line)?.[1];
    return { table: opened, countable: opened === undefined };
  }
  return line === "\\." ? { table: undefined, countable: false } : { table, countable: true };
};

const countTokens = (
  hits: ReadonlyMap<string, Map<string, number>>,
  tokens: readonly string[],
  line: string,
  where: string,
): void => {
  for (const token of tokens) {
    if (!line.includes(token)) continue;
    const counted = hits.get(token);
    counted?.set(where, (counted.get(where) ?? 0) + 1);
  }
};

const perSectionHits = (
  text: string,
  tokens: readonly string[],
): ReadonlyMap<string, ReadonlyMap<string, number>> => {
  const hits = new Map<string, Map<string, number>>(
    tokens.map((token) => [token, new Map<string, number>()]),
  );
  let table: string | undefined;
  for (const line of text.split("\n")) {
    const scanned = scanLine(table, line);
    table = scanned.table;
    if (scanned.countable) countTokens(hits, tokens, line, table ?? OUTSIDE_ANY_SECTION);
  }
  return hits;
};

type DumpGrepAsked = { readonly tokens: readonly string[] };

export const dumpGrepAskedOf = (flags: Flags): Result<DumpGrepAsked, string> => {
  const tokens = [
    ...new Set(
      (flagValue(flags, "tokens") ?? "")
        .split(",")
        .map((token) => token.trim())
        .filter((token) => token.length > 0),
    ),
  ];
  return tokens.length === 0 ? err("--tokens <a,b,…> is required") : ok({ tokens });
};

export const dumpGrep = async ({ tokens }: DumpGrepAsked, io: OpsIo): Promise<number> => {
  const hits = perSectionHits(await io.stdin(), tokens);
  for (const token of tokens) {
    const counted = hits.get(token);
    if (counted === undefined || counted.size === 0) {
      io.say(`${maskToken(token)}: absent`);
      continue;
    }
    for (const [where, lines] of counted) {
      const place =
        where === OUTSIDE_ANY_SECTION ? "outside any COPY section" : `of table ${where}`;
      io.say(`${maskToken(token)}: present in ${lines} line(s) ${place}`);
    }
  }
  return 0;
};
