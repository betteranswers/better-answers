import { describe, expect, it } from "vitest";

import { facesAdmittingNobody } from "@better-answers/devtools/face-admission";

const FACE = "slice";
const INDEX = "slice/index.ts";

const namedIn = (sources: Readonly<Record<string, string>>): readonly string[] =>
  facesAdmittingNobody(sources, [FACE]).map(({ name }) => name);

const taking = (annotation: string): string =>
  `export const read = async (principal: ${annotation}, tx: Tx) => tx.query("SELECT 1");\n`;

describe("the face functions that take a person and admit nobody", () => {
  it("names one with its face, file and line", () => {
    const source = `const unrelated = 1;\n${taking("UserPrincipal")}`;

    expect(facesAdmittingNobody({ [INDEX]: source }, [FACE])).toEqual([
      { face: "slice", name: "read", file: "slice/index.ts", line: 2 },
    ]);
  });

  it("stays silent on one that passes a declaration to admit", () => {
    const source = `export const read = async (principal: UserPrincipal, tx: Tx) => {
  const admitted = admit(readAction, principal, {});
  if (!admitted.ok) return admitted;
  return tx.query("SELECT 1");
};
`;

    expect(namedIn({ [INDEX]: source })).toEqual([]);
  });

  it("stays silent on one that admits inside a callback", () => {
    const source = `export const read = (principal: Principal, door: Door) =>
  door.run((tx) => {
    const admitted = admit(readAction, principal, {});
    return admitted.ok ? tx.query("SELECT 1") : admitted;
  });
`;

    expect(namedIn({ [INDEX]: source })).toEqual([]);
  });

  it("names one whose admit is handed no declaration", () => {
    const source = `export const read = async (principal: UserPrincipal) => {
  const admitted = admit({ admits: ANY_ROLE }, principal, {});
  return admitted;
};
`;

    expect(namedIn({ [INDEX]: source })).toEqual(["read"]);
  });

  it("names one declared above a neighbour that admits", () => {
    const source = `export const read = async (principal: UserPrincipal) => principal;
export const write = (principal: UserPrincipal) => admit(writeAction, principal, {});
`;

    expect(namedIn({ [INDEX]: source })).toEqual(["read"]);
  });

  it("names one that hands a declaration to another function", () => {
    const source = `export const read = (principal: UserPrincipal) => gate(readAction, principal);\n`;

    expect(namedIn({ [INDEX]: source })).toEqual(["read"]);
  });

  it("names one that leaves the admitting to a neighbour", () => {
    const source = `const gate = (principal: UserPrincipal) => admit(readAction, principal, {});
export const read = async (principal: UserPrincipal) => principal;
`;

    expect(namedIn({ [INDEX]: source })).toEqual(["read"]);
  });
});

describe("the parameters read as a person of any role", () => {
  it.each([
    "Principal",
    "PlatformPrincipal | UserPrincipal",
    "(UserPrincipal)",
    "UserPrincipal & Held",
    "AdmittedOf<typeof readAction>",
    "{ principal: UserPrincipal }",
    "Readonly<UserPrincipal>",
    "kernel.UserPrincipal",
    "readonly UserPrincipal[]",
  ])("names one taking %s", (annotation) => {
    expect(namedIn({ [INDEX]: taking(annotation) })).toEqual(["read"]);
  });

  it.each([
    "AdminUserPrincipal",
    "PlatformPrincipal",
    "OperatorPrincipal",
    "ErasurePrincipal",
    "PlatformPrincipal | AdminUserPrincipal",
    "(reader: UserPrincipal) => Promise<void>",
    "new (p: UserPrincipal) => R",
  ])("stays silent on one taking %s", (annotation) => {
    expect(namedIn({ [INDEX]: taking(annotation) })).toEqual([]);
  });

  it("names a function whose person has a default value", () => {
    const source = `export const read = (principal: UserPrincipal = ANYONE) => principal;\n`;

    expect(namedIn({ [INDEX]: source })).toEqual(["read"]);
  });

  it("names a function generic over the person it takes", () => {
    const source = `export const read = <P extends UserPrincipal>(principal: P) => principal;\n`;

    expect(namedIn({ [INDEX]: source })).toEqual(["read"]);
  });

  it("names a function taking any number of people", () => {
    const source = `export const read = (...people: UserPrincipal[]) => people;\n`;

    expect(namedIn({ [INDEX]: source })).toEqual(["read"]);
  });

  it("names a function whose person is its second parameter", () => {
    const source = `export const read = (tx: Tx, principal: UserPrincipal) => tx.query(principal);\n`;

    expect(namedIn({ [INDEX]: source })).toEqual(["read"]);
  });
});

describe("the functions a face's index exports", () => {
  const beside = taking("UserPrincipal");

  it.each([
    ["re-exported by name", `export { read as readThing, type Thing } from "./thing.ts";\n`],
    [
      "imported then listed",
      `import { read, type Thing } from "./thing.ts";\nexport { read as readThing };\n`,
    ],
  ])("names one %s, under the face's name", (_how, index) => {
    const sources = { [INDEX]: index, "slice/thing.ts": `export type Thing = 1;\n${beside}` };

    expect(facesAdmittingNobody(sources, [FACE])).toEqual([
      { face: "slice", name: "readThing", file: "slice/thing.ts", line: 2 },
    ]);
  });

  it("names every function of a file re-exported whole", () => {
    const sources = {
      [INDEX]: `export * from "./thing.ts";\n`,
      "slice/thing.ts": `${beside}export function write(principal: UserPrincipal) {}\n`,
    };

    expect(namedIn(sources)).toEqual(["read", "write"]);
  });

  it("names one a re-exported file re-exports in turn", () => {
    const sources = {
      [INDEX]: `export * from "./things/index.ts";\n`,
      "slice/things/index.ts": `export { read } from "./thing.ts";\n`,
      "slice/things/thing.ts": beside,
    };

    expect(namedIn(sources)).toEqual(["read"]);
  });

  it("reads the index's own function over a whole re-export's", () => {
    const sources = {
      [INDEX]: `export * from "./thing.ts";
export const read = (principal: UserPrincipal) => admit(readAction, principal, {});
`,
      "slice/thing.ts": beside,
    };

    expect(namedIn(sources)).toEqual([]);
  });

  it.each([
    "function (principal: UserPrincipal) {}",
    "(async (principal: UserPrincipal) => principal)",
    "((p: UserPrincipal) => p) satisfies Reader",
    "((p: UserPrincipal) => p) as Reader",
  ])("names one written %s", (written) => {
    expect(namedIn({ [INDEX]: `export const read = ${written};\n` })).toEqual(["read"]);
  });

  it("names one exported in a list after its declaration", () => {
    const source = `const read = async (principal: UserPrincipal) => principal;
function write(principal: UserPrincipal) {}
export { read, write as writeThing };
`;

    expect(namedIn({ [INDEX]: source })).toEqual(["read", "writeThing"]);
  });

  it("leaves a function only its own file exports", () => {
    const sources = {
      [INDEX]: `export { other } from "./thing.ts";\nconst local = (principal: UserPrincipal) => 1;\n`,
      "slice/thing.ts": `${beside}export const other = (tx: Tx) => tx;\n`,
    };

    expect(namedIn(sources)).toEqual([]);
  });

  it("leaves a function re-exported only as a type", () => {
    const sources = {
      [INDEX]: `export type * from "./thing.ts";\nexport type { read } from "./thing.ts";\n`,
      "slice/thing.ts": beside,
    };

    expect(namedIn(sources)).toEqual([]);
  });

  it("leaves another directory's function to that directory's face", () => {
    const sources = {
      [INDEX]: `export { read } from "../other/index.ts";\n`,
      "other/index.ts": beside,
    };

    expect(namedIn(sources)).toEqual([]);
    expect(facesAdmittingNobody(sources, ["other", FACE])).toEqual([
      { face: "other", name: "read", file: "other/index.ts", line: 1 },
    ]);
  });

  it("orders what it names by face, then by name", () => {
    const sources = {
      [INDEX]: `${beside}export const ask = (principal: UserPrincipal) => principal;\n`,
      "other/index.ts": beside,
    };

    expect(
      facesAdmittingNobody(sources, [FACE, "other"]).map(({ face, name }) => `${face}/${name}`),
    ).toEqual(["other/read", "slice/ask", "slice/read"]);
  });
});

describe("a tree the reader cannot read", () => {
  it("throws on a face whose index is no source", () => {
    expect(() => facesAdmittingNobody({}, [FACE])).toThrow("slice/index.ts");
  });

  it("throws on a re-exported file that is no source", () => {
    const sources = { [INDEX]: `export * from "./thing.ts";\n` };

    expect(() => facesAdmittingNobody(sources, [FACE])).toThrow("slice/thing.ts");
  });

  it("throws on a default export, which it does not follow", () => {
    const source = `export default (principal: UserPrincipal) => principal;\n`;

    expect(() => facesAdmittingNobody({ [INDEX]: source }, [FACE])).toThrow("a default export");
  });

  it("throws on a namespace re-export, which it does not follow", () => {
    const sources = { [INDEX]: `export * as things from "./thing.ts";\n`, "slice/thing.ts": "" };

    expect(() => facesAdmittingNobody(sources, [FACE])).toThrow("a namespace re-export");
  });

  it("throws on a file that does not parse", () => {
    expect(() => facesAdmittingNobody({ [INDEX]: "export const = ;" }, [FACE])).toThrow(
      "does not parse",
    );
  });
});
