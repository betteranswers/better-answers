import { describe, expect, it } from "vitest";

import { SCAN_EXECUTABLE } from "@better-answers/devtools/auth-seam-scan";
import { runsOverThrowawayTree } from "@better-answers/devtools/throwaway-tree";
import type { Tree } from "@better-answers/devtools/throwaway-tree";

const SEAM = "src/auth-hooks.ts";

const WORKSPACE: Tree = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: {
      strict: true,
      target: "es2024",
      module: "preserve",
      moduleResolution: "bundler",
      noEmit: true,
    },
    include: ["src"],
  }),
  "node_modules/better-auth/package.json": JSON.stringify({
    name: "better-auth",
    exports: { ".": { types: "./index.d.ts" } },
  }),
  "node_modules/better-auth/index.d.ts":
    "export type Session = { readonly id: string; readonly activeOrganizationId: string | null };\nexport declare const client: { getSession(): Promise<Session> };\n",
  "node_modules/hidden-types/package.json": JSON.stringify({
    name: "hidden-types",
    exports: { ".": { types: "./index.d.ts" } },
  }),
  "node_modules/hidden-types/index.d.ts":
    'import type { Hidden } from "./hidden.js";\nexport declare const made: () => Hidden;\n',
  "node_modules/hidden-types/hidden.d.ts": "export interface Hidden { readonly id: string }\n",
};

const seamed = (source: string, beside: Tree = {}): Tree => ({
  ...WORKSPACE,
  ...beside,
  [SEAM]: `import { client } from "better-auth";\n\n${source}`,
});

const LEAKS = seamed("export const readSession = () => client.getSession();\n");

const MAPPED_SOURCE =
  "type SessionHeld = { readonly id: string };\n\nexport const readSession = (): Promise<SessionHeld> =>\n  client.getSession().then((session) => ({ id: session.id }));\n";

const MAPPED = seamed(MAPPED_SOURCE);

const scan = runsOverThrowawayTree({
  executable: SCAN_EXECUTABLE,
  argv: ["tsconfig.json", SEAM],
  foundSomething: [1],
  smoke: { tree: LEAKS, reports: (output) => output.includes(`${SEAM}: the declaration of`) },
});

describe("the auth seam's declarations", () => {
  it("refuses an export whose declaration names Better Auth", () => {
    expect(scan(LEAKS)).toContain(
      `${SEAM}: the declaration of \`readSession\` names \`better-auth\`.`,
    );
  });

  it("passes an export typed in the platform's own shape", () => {
    expect(scan(MAPPED)).toBe(`${SEAM}: its declarations name no Better Auth type\n`);
  });

  it("refuses the auth client re-exported through the seam", () => {
    const tree = seamed(`${MAPPED_SOURCE}\nexport { authClient } from "./auth-client.ts";\n`, {
      "src/auth-client.ts": 'export { client as authClient } from "better-auth";\n',
    });

    expect(scan(tree)).toContain(
      `${SEAM}: the declaration of \`authClient\` names \`./auth-client.ts\`.`,
    );
  });

  it("refuses an export whose inferred type TypeScript cannot name", () => {
    const tree = seamed(
      'import { made } from "hidden-types";\n\nexport const madeHere = () => made();\n',
    );

    expect(scan(tree)).toMatch(/^src\/auth-hooks\.ts:5: TypeScript refused the file \(TS2883:/);
  });

  it("reads past a refusal in a file the seam imports", () => {
    const tree = seamed(`${MAPPED_SOURCE}\nexport { count } from "./beside";\n`, {
      "src/beside.ts": 'export const count: number = "one";\n',
    });

    expect(scan(tree)).toBe(`${SEAM}: its declarations name no Better Auth type\n`);
  });

  it("stops when no declaration is written", () => {
    expect(() => scan({ ...WORKSPACE, "src/elsewhere.ts": "export {};\n" })).toThrow(
      /tsc wrote no declaration for src\/auth-hooks\.ts/,
    );
  });
});
