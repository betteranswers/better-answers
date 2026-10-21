import { describe, expect, it } from "vitest";

import { pluginConfigFor } from "@better-answers/devtools/oxlint-config";
import { oxlintOver } from "@better-answers/devtools/throwaway-tree";
import type { Tree } from "@better-answers/devtools/throwaway-tree";

const RULE = "better-answers/auth-types-stay-in-the-seam";
const FILE = "probe.ts";

const holding = (source: string): Tree => ({ [FILE]: source });

const CLIENT = 'import { authClient } from "./auth-client.ts";\n';

const UNMAPPED_SESSION = `${CLIENT}const read = () => authClient.getSession();\nexport const useSession = () => read();\n`;

const lint = oxlintOver(pluginConfigFor({ [RULE]: "error" }), {
  tree: holding(UNMAPPED_SESSION),
  flagged: [FILE],
});

describe("Better Auth's types stay in the auth seam", () => {
  it("refuses an unmapped session hook, naming the fix", () => {
    const output = lint.output(holding(UNMAPPED_SESSION));

    expect(output).toContain("better-answers(auth-types-stay-in-the-seam)");
    expect(output).toContain("`useSession` is exported with an inferred type");
    expect(output).toContain("map what the library answers to it inside auth-hooks.ts");
  });

  it.each([
    [
      "a return type naming the client",
      `${CLIENT}export const useSession = (): ReturnType<typeof authClient.getSession> => authClient.getSession();\n`,
    ],
    [
      "a type alias over `$Infer`",
      `${CLIENT}export type Leaked = typeof authClient.$Infer.Session;\n`,
    ],
    [
      "an alias over a local inferred alias",
      `${CLIENT}type Raw = Awaited<ReturnType<typeof authClient.getSession>>;\nexport type Shown = Raw;\n`,
    ],
    [
      "a library type in a written signature",
      'import type { BetterFetchError } from "better-auth/client";\nexport const failure = (): BetterFetchError | null => null;\n',
    ],
    [
      "an inferred value off the client",
      `${CLIENT}export const organization = authClient.organization;\n`,
    ],
    ["the client exported again", `${CLIENT}export { authClient };\n`],
    ["a re-export of the client module", 'export { authClient } from "./auth-client.ts";\n'],
    ["a re-export of the library", 'export * from "better-auth/client";\n'],
  ])("refuses %s", (_shape, source) => {
    expect(lint.output(holding(source))).toContain("better-answers(auth-types-stay-in-the-seam)");
  });

  it.each([
    [
      "a hook mapping the answer to a written type",
      `${CLIENT}type Session = { readonly id: string };\nconst read = () => authClient.getSession();\nexport const useSession = (): Session => ({ id: String(read()) });\n`,
    ],
    [
      "an export that never reads the library",
      `${CLIENT}void authClient;\nexport const hasADisplayName = (name: string) => name.trim() !== "";\n`,
    ],
    [
      "a type inferred from a schema",
      'import { z } from "zod";\nconst shape = z.object({ url: z.string() });\nexport type Shape = z.infer<typeof shape>;\n',
    ],
    [
      "a page reading a hook's written type",
      'import { useSession } from "./auth-hooks.ts";\nexport type Read = ReturnType<typeof useSession>;\n',
    ],
  ])("allows %s", (_shape, source) => {
    expect(lint.flagged(holding(source))).toEqual([]);
  });
});
