import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { repositoryRoot } from "@better-answers/devtools/paths";
import { executableOf, runsOverThrowawayTree } from "@better-answers/devtools/throwaway-tree";
import type { Tool, Tree } from "@better-answers/devtools/throwaway-tree";

const MODULE = "apps/worker/src/better_answers_worker/probe.py";

const PORTED = "packages/schema/src/concept-file.ts";

const ABSENT = "packages/schema/src/concept.ts";

const MANIFEST = "contracts/manifest.json";

const AGREEMENTS = JSON.stringify({ agreements: { links: {}, queue: {} } });

type Fields = {
  readonly portOf: string | null;
  readonly agreement: string | null;
  readonly after: string | null;
};

const PASSING: Fields = {
  portOf: `PORT_OF = ("${PORTED}",)`,
  agreement: 'AGREEMENT = "links"',
  after: null,
};

const moduleOf = (changed: Partial<Fields> = {}): string => {
  const fields = { ...PASSING, ...changed };
  return [fields.portOf, fields.agreement, fields.after, "KEEP = 1"]
    .filter((line) => line !== null)
    .map((line) => `${line}\n`)
    .join("");
};

const declaring = (changed: Partial<Fields> = {}): Tree => ({
  [MANIFEST]: AGREEMENTS,
  [MODULE]: moduleOf(changed),
});

const scan: Tool = {
  executable: { package: "@better-answers/devtools", path: ["python", "port_scan.py"] },
  argv: ["apps/worker/src"],
  scaffold: { [PORTED]: "export const ported = 1;\n" },
  foundSomething: [1],
  smoke: {
    tree: declaring({ agreement: null }),
    reports: (output) => output.includes(`${MODULE}:1:`),
  },
};

const run = runsOverThrowawayTree(scan);

const findings = (tree: Tree): readonly string[] =>
  run(tree)
    .split("\n")
    .filter((line) => line !== "");

const passed = (modules: number): string =>
  `port_scan: every port names TypeScript modules the tree holds and an agreement in contracts/manifest.json (ports: 1, modules read: ${String(modules)})`;

const refusal = (message: string): RegExp =>
  new RegExp(`exit 2\\n\\nport_scan: ${message.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n$`);

const SHAPES = {
  PORT_OF:
    '`PORT_OF = ("packages/<package>/src/<module>.ts",)`, a non-empty tuple of string literals',
  AGREEMENT:
    '`AGREEMENT = "<key>"`, a string literal naming a key of contracts/manifest.json\'s agreements',
} as const;

const notALiteral = (line: number, name: keyof typeof SHAPES): string =>
  `${MODULE}:${String(line)}: \`${name}\` is not assigned alone as a literal of the shape the gate reads. The gate reads only that form, so any other would pass unchecked. Write it as ${SHAPES[name]}.`;

const notAModule = (ported: string): string =>
  `${MODULE}:1: \`PORT_OF\` names \`${ported}\`, which is not a TypeScript module the tree holds, so the port does not say what it mirrors. Name each module as it now stands, by its path from the repository root, with no \`..\` segment, ending \`.ts\` or \`.tsx\`.`;

const unknownAgreement = (line: number, agreement: string): string =>
  `${MODULE}:${String(line)}: \`AGREEMENT\` names \`${agreement}\`, which contracts/manifest.json's agreements do not hold, so no fixture holds this port. Name a key of contracts/manifest.json's agreements, or add the agreement to contracts/ in its own pull request.`;

const halfDeclared = (
  line: number,
  present: keyof typeof SHAPES,
  missing: keyof typeof SHAPES,
): string =>
  `${MODULE}:${String(line)}: this module declares \`${present}\` but not \`${missing}\`, and a port declares both, so that what it mirrors and the fixture holding the two tiers to one behaviour are both named. Add ${SHAPES[missing]}.`;

const declaredTwice = (line: number, name: keyof typeof SHAPES): string =>
  `${MODULE}:${String(line)}: \`${name}\` is declared twice in this module, so which value holds depends on the order. Declare it once.`;

const augmented = (line: number, name: keyof typeof SHAPES, module = MODULE): string =>
  `${module}:${String(line)}: \`${name}\` is extended by an augmented assignment, which the gate does not read, so what it adds would pass unchecked. Declare the whole value once, as ${SHAPES[name]}.`;

describe("the port scan over a throwaway tree", () => {
  it("passes a port naming an agreement the manifest has", () => {
    expect(findings(declaring())).toEqual([passed(1)]);
  });

  it("passes a port declared with a type annotation", () => {
    const annotated = { portOf: `PORT_OF: tuple[str, ...] = ("${PORTED}",)` };

    expect(findings(declaring(annotated))).toEqual([passed(1)]);
  });

  it("passes a module led by a byte-order mark", () => {
    const tree = { ...declaring(), [MODULE]: `﻿${moduleOf()}` };

    expect(findings(tree)).toEqual([passed(1)]);
  });

  it("refuses a port naming no agreement, naming the fix", () => {
    expect(findings(declaring({ agreement: null }))).toEqual([
      halfDeclared(1, "PORT_OF", "AGREEMENT"),
    ]);
  });

  it("refuses an agreement declared with no ported module", () => {
    expect(findings(declaring({ portOf: null }))).toEqual([
      halfDeclared(1, "AGREEMENT", "PORT_OF"),
    ]);
  });

  it("refuses a port naming an agreement the manifest lacks", () => {
    expect(findings(declaring({ agreement: 'AGREEMENT = "lnks"' }))).toEqual([
      unknownAgreement(2, "lnks"),
    ]);
  });

  it.each([
    ["the tree lacks", ABSENT],
    ["given absolute", path.join(repositoryRoot, PORTED)],
    ["climbing with ..", "packages/schema/../schema/src/concept-file.ts"],
    ["not ending .ts", MANIFEST],
  ])("refuses a ported path %s", (_what, ported) => {
    expect(findings(declaring({ portOf: `PORT_OF = ("${ported}",)` }))).toEqual([
      notAModule(ported),
    ]);
  });

  it("refuses only the missing path among several", () => {
    const several = { portOf: `PORT_OF = ("${PORTED}", "${ABSENT}")` };

    expect(findings(declaring(several))).toEqual([notAModule(ABSENT)]);
  });

  it.each([
    ["PORT_OF as a bare string", { portOf: `PORT_OF = "${PORTED}"` }, "PORT_OF", 1],
    ["PORT_OF as an empty tuple", { portOf: "PORT_OF = ()" }, "PORT_OF", 1],
    ["PORT_OF holding a name", { portOf: `PORT_OF = ("${PORTED}", PORTED)` }, "PORT_OF", 1],
    ["PORT_OF holding a number", { portOf: `PORT_OF = ("${PORTED}", 1)` }, "PORT_OF", 1],
    ["PORT_OF chained", { portOf: `PORT_OF = KEPT = ("${PORTED}",)` }, "PORT_OF", 1],
    ["PORT_OF unpacked", { portOf: `PORT_OF, KEPT = ("${PORTED}",), 1` }, "PORT_OF", 1],
    ["AGREEMENT as a name", { agreement: "AGREEMENT = LINKS" }, "AGREEMENT", 2],
  ] as const)("refuses %s, not a literal", (_what, changed, name, line) => {
    expect(findings(declaring(changed))).toEqual([notALiteral(line, name)]);
  });

  it("refuses a name declared twice in one module", () => {
    expect(findings(declaring({ after: 'AGREEMENT = "links"' }))).toEqual([
      declaredTwice(3, "AGREEMENT"),
    ]);
  });

  it.each([
    ["PORT_OF", `PORT_OF += ("${ABSENT}",)`],
    ["AGREEMENT", 'AGREEMENT += "s"'],
  ] as const)("refuses %s extended after its declaration", (name, after) => {
    expect(findings(declaring({ after }))).toEqual([augmented(3, name)]);
  });

  it("refuses an extension in a module declaring nothing", () => {
    const extending = "apps/worker/src/extending.py";
    const tree = { ...declaring(), [extending]: `PORT_OF += ("${ABSENT}",)\nKEEP = 1\n` };

    expect(findings(tree)).toEqual([augmented(1, "PORT_OF", extending)]);
  });

  it("reports every finding on one module, in line order", () => {
    expect(findings(declaring({ after: 'AGREEMENT = "lnks"' }))).toEqual([
      declaredTwice(3, "AGREEMENT"),
      unknownAgreement(3, "lnks"),
    ]);
  });

  it("walks past a module that declares no port", () => {
    const tree = { ...declaring(), "apps/worker/src/plain.py": "KEEP = 1\n" };

    expect(findings(tree)).toEqual([passed(2)]);
  });

  it.each([
    ["a function", "def held() -> None:\n"],
    ["an if block", "if KEEP:\n"],
  ])("ignores a declaration inside %s", (_what, opener) => {
    const held = `KEEP = 1\n${opener}    PORT_OF = ("${ABSENT}",)\n    AGREEMENT = "lnks"\n`;
    const tree = { ...declaring(), "apps/worker/src/held.py": held };

    expect(findings(tree)).toEqual([passed(2)]);
  });

  it("refuses a walk that read no Python file", () => {
    const noModule = { [MANIFEST]: AGREEMENTS, "apps/worker/src/README.md": "# probe\n" };

    expect(() => run(noModule)).toThrow(refusal("no Python file under apps/worker/src"));
  });

  it("refuses a tree with no manifest", () => {
    expect(() => run({ [MODULE]: moduleOf() })).toThrow(
      /exit 2\n\nport_scan: contracts\/manifest\.json could not be read: /,
    );
  });

  it("refuses a manifest that names no agreement", () => {
    expect(() => run({ ...declaring(), [MANIFEST]: '{"agreements": {}}' })).toThrow(
      refusal("contracts/manifest.json names no agreement, so no port could name one"),
    );
  });

  it("refuses a module that does not parse, naming it", () => {
    const broken = { ...declaring(), "apps/worker/src/broken.py": "def broken(\n" };

    expect(() => run(broken)).toThrow(
      /exit 2\n\nport_scan: apps\/worker\/src\/broken\.py could not be read: /,
    );
  });

  it("refuses a walk that found no port", () => {
    expect(() => run({ ...declaring(), [MODULE]: "KEEP = 1\n" })).toThrow(
      refusal(
        "no module under apps/worker/src declares `PORT_OF` or `AGREEMENT`, so the walk proved nothing",
      ),
    );
  });

  it.each([
    ["no directory to read", [], "name at least one directory to read"],
    ["a directory the tree lacks", ["packages", "absent"], "no directory at absent"],
  ])("refuses a run naming %s", (_what, argv, message) => {
    const naming: Tool = { ...scan, argv, smoke: { tree: {}, reports: () => true } };

    expect(() => runsOverThrowawayTree(naming)).toThrow(refusal(message));
  });
});

const rootScripts = z.object({ scripts: z.object({ "port-scan": z.string() }) });

describe("the port scan over the repository", () => {
  it("passes the worker's own tree", () => {
    const manifest = readFileSync(path.join(repositoryRoot, "package.json"), "utf8");
    const [, , ...argv] = rootScripts.parse(JSON.parse(manifest)).scripts["port-scan"].split(" ");

    const output = execFileSync(executableOf(scan.executable), argv, {
      cwd: repositoryRoot,
      encoding: "utf8",
    });

    expect(output).toMatch(
      /^port_scan: every port names TypeScript modules the tree holds and an agreement in contracts\/manifest\.json \(ports: \d+, modules read: \d+\)\n$/,
    );
  });
});
