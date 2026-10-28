import type { Logger } from "pino";

import type { BundleTree } from "@better-answers/core/concepts";
import type { RefusalClass, Result } from "@better-answers/core/kernel";
import type { ModelKeySetting } from "@better-answers/core/llm";
import type { GitDoor } from "@better-answers/core/store/git";

import { doorTold, type Doors } from "../doors.ts";
import type { Mail } from "../email/email.ts";
import { refusalOf, type RefusalWord } from "../refusal.ts";

export const DONE = 0;
export const REFUSED = 1;
export const USAGE = 2;
export const NOT_BUILT = 3;

export const EXIT_OF_CLASS = {
  malformed: USAGE,
  unauthenticated: 4,
  forbidden: 5,
  absent: 6,
  inapplicable: 7,
  conflict: 8,
  precondition: 9,
} as const satisfies Readonly<Record<RefusalClass, number>>;

export type OpsIo = {
  readonly fetch: (url: string, init?: RequestInit) => Promise<Response>;

  readonly stdin: () => Promise<string>;
  readonly say: (line: string) => void;

  readonly logger: Logger;

  readonly appHostname?: string | undefined;

  readonly writeReport?: ((path: string, body: string) => Promise<void>) | undefined;

  readonly readTree?: ((directory: string) => Promise<BundleTree>) | undefined;

  readonly mail?: Mail | undefined;

  readonly modelKeySetting: Result<ModelKeySetting, string>;
};

export const parseSince = (value: string): Date | undefined => {
  const stamp = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/u.exec(value);
  const iso =
    stamp === null
      ? value
      : `${stamp[1]}-${stamp[2]}-${stamp[3]}T${stamp[4]}:${stamp[5]}:${stamp[6]}Z`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

export type Flags = ReadonlyMap<string, string | true>;

export const parseFlags = (argv: readonly string[]): Flags => {
  const flags = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    if (!argument.startsWith("--")) continue;
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags.set(argument.slice(2), next);
      index += 1;
    } else {
      flags.set(argument.slice(2), true);
    }
  }
  return flags;
};

export const flagValue = (flags: Flags, name: string): string | undefined => {
  const value = flags.get(name);
  return typeof value === "string" ? value : undefined;
};

export const bundleStore = (doors: Doors, purpose: string): Result<GitDoor, string> =>
  doorTold(
    doors.git,
    `no repositories' root is configured (GIT_STORE_DIR), so ${purpose}; the estate sets it to /data/git on the api service`,
  );

export const reasonOf = (reason: string | Error): string =>
  typeof reason === "string" ? reason : reason.message;

export const refused = (
  command: string,
  workspaceId: string,
  reason: RefusalWord | Error,
  io: OpsIo,
  said?: string,
): number => {
  if (reason instanceof Error) {
    io.say(`${command}: REFUSED — ${reason.message}`);
    return REFUSED;
  }
  const refusal = refusalOf(reason);
  const about =
    refusal.word === "malformed" ? `: --workspace ${workspaceId} is not a workspace id` : "";
  io.say(`${command}: REFUSED — ${said ?? `${refusal.word}${about}`}`);
  return EXIT_OF_CLASS[refusal.class];
};

export const exitOf = (refusal: RefusalWord | Error): number =>
  refusal instanceof Error ? REFUSED : EXIT_OF_CLASS[refusalOf(refusal).class];

export const plural = (many: number, noun: string): string => `${noun}${many === 1 ? "" : "s"}`;
export const counted = (many: number, noun: string): string => `${many} ${plural(many, noun)}`;
