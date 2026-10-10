import path from "node:path";

import {
  type ArrowFunctionExpression,
  type CallExpression,
  type Declaration,
  type ExportNamedDeclaration,
  type Expression,
  type Function as FunctionNode,
  type ModuleExportName,
  type ParamPattern,
  type Statement,
  type TSType,
  Visitor,
} from "oxc-parser";

import { parsedSource } from "./parsed-source.ts";

/** A person of any role fits each. The kernel's narrower names are left out: only `admit` makes an Admin. */
const FITS_ANY_PERSON: ReadonlySet<string> = new Set(["UserPrincipal", "Principal", "AdmittedOf"]);

const ADMIT = "admit";

const FACE_FILE = "index.ts";

/** Keyed by path under the source root, with `/` between its parts. */
type Sources = Readonly<Record<string, string>>;

export type UnadmittedFace = {
  readonly face: string;
  readonly name: string;
  readonly file: string;
  readonly line: number;
};

type FunctionShape = FunctionNode | ArrowFunctionExpression;

type Declared = { readonly name: string; readonly at: number; readonly node: FunctionShape };

type Found = {
  readonly file: string;
  readonly line: number;
  readonly takesAPerson: boolean;
  readonly admits: boolean;
};

type ReExport = { readonly name: string; readonly local: string; readonly from: string };

type Module = {
  /** Each function the file declares and exports, under the name it is exported by. */
  readonly own: ReadonlyMap<string, Found>;
  readonly named: readonly ReExport[];
  readonly whole: readonly string[];
};

const namesAPerson = (type: TSType): boolean => {
  switch (type.type) {
    case "TSTypeReference":
      return type.typeName.type === "Identifier" && FITS_ANY_PERSON.has(type.typeName.name);
    case "TSUnionType":
    case "TSIntersectionType":
      return type.types.some(namesAPerson);
    case "TSParenthesizedType":
      return namesAPerson(type.typeAnnotation);
    default:
      return false;
  }
};

const takesAPerson = (param: ParamPattern): boolean => {
  if (param.type === "TSParameterProperty") return false;
  const bound = param.type === "AssignmentPattern" ? param.left : param;
  const annotation = bound.typeAnnotation?.typeAnnotation;
  return annotation !== undefined && namesAPerson(annotation);
};

/** A declaration is passed by its name, as the lint that pairs the two reads it. */
const passesADeclaration = ({ callee, arguments: [first] }: CallExpression): boolean =>
  callee.type === "Identifier" && callee.name === ADMIT && first?.type === "Identifier";

const functionOf = (init: Expression | null): FunctionShape | undefined =>
  init?.type === "ArrowFunctionExpression" || init?.type === "FunctionExpression"
    ? init
    : undefined;

const declaredBy = (declaration: Declaration | Statement): readonly Declared[] => {
  if (declaration.type === "FunctionDeclaration") {
    const { id } = declaration;
    return id === null ? [] : [{ name: id.name, at: id.start, node: declaration }];
  }
  if (declaration.type !== "VariableDeclaration") return [];
  return declaration.declarations.flatMap(({ id, init }) => {
    const node = functionOf(init);
    return id.type === "Identifier" && node !== undefined
      ? [{ name: id.name, at: id.start, node }]
      : [];
  });
};

const nameOf = (name: ModuleExportName): string => ("name" in name ? name.name : name.value);

type Listed = { readonly name: string; readonly local: string };

const listedBy = ({ exportKind, specifiers }: ExportNamedDeclaration): readonly Listed[] =>
  exportKind === "type"
    ? []
    : specifiers
        .filter((specifier) => specifier.exportKind !== "type")
        .map(({ exported, local }) => ({ name: nameOf(exported), local: nameOf(local) }));

const moduleOf = (file: string, source: string): Module => {
  const { program, lineOf } = parsedSource(file, source);
  const admissions: number[] = [];
  new Visitor({
    CallExpression: (node) => {
      if (passesADeclaration(node)) admissions.push(node.start);
    },
  }).visit(program);

  const functions = new Map<string, Found>();
  const exported = new Map<string, string>();
  const named: ReExport[] = [];
  const whole: string[] = [];

  const declare = (declaration: Declaration | Statement, isExported: boolean): void => {
    for (const { name, at, node } of declaredBy(declaration)) {
      functions.set(name, {
        file,
        line: lineOf(at),
        takesAPerson: node.params.some(takesAPerson),
        admits: admissions.some((call) => node.start <= call && call < node.end),
      });
      if (isExported) exported.set(name, name);
    }
  };

  const exportNamed = (statement: ExportNamedDeclaration): void => {
    if (statement.declaration !== null) declare(statement.declaration, true);
    const from = statement.source?.value;
    for (const { name, local } of listedBy(statement)) {
      if (from === undefined) exported.set(name, local);
      else named.push({ name, local, from });
    }
  };

  for (const statement of program.body) {
    if (statement.type === "ExportNamedDeclaration") exportNamed(statement);
    else if (statement.type !== "ExportAllDeclaration") declare(statement, false);
    else if (statement.exportKind !== "type" && statement.exported === null) {
      whole.push(statement.source.value);
    }
  }
  const own = new Map<string, Found>();
  for (const [name, local] of exported) {
    const declared = functions.get(local);
    if (declared !== undefined) own.set(name, declared);
  }
  return { own, named, whole };
};

/** A re-export from another directory is that directory's own face to answer for. */
const isBeside = (specifier: string): boolean => specifier.startsWith("./");

const beside = (file: string, specifier: string): string =>
  path.posix.join(path.posix.dirname(file), specifier);

/**
 * Reads a parameter's own annotation: a principal behind an alias goes unseen.
 *
 * @throws when a file does not parse or a re-export names none.
 */
export const facesAdmittingNobody = (
  sources: Sources,
  faces: readonly string[],
): readonly UnadmittedFace[] => {
  const read = new Map<string, ReadonlyMap<string, Found>>();

  const exportedFrom = (file: string): ReadonlyMap<string, Found> => {
    const known = read.get(file);
    if (known !== undefined) return known;
    const source = sources[file];
    if (source === undefined) throw new Error(`${file} is exported from and is not a source`);

    const { own, named, whole } = moduleOf(file, source);
    const found = new Map(own);
    read.set(file, found);
    for (const from of whole.filter(isBeside)) {
      for (const [name, declared] of exportedFrom(beside(file, from))) found.set(name, declared);
    }
    for (const { name, local, from } of named.filter((one) => isBeside(one.from))) {
      const declared = exportedFrom(beside(file, from)).get(local);
      if (declared !== undefined) found.set(name, declared);
    }
    return found;
  };

  return faces
    .flatMap((face) =>
      [...exportedFrom(`${face}/${FACE_FILE}`)]
        .filter(([, found]) => found.takesAPerson && !found.admits)
        .map(([name, { file, line }]) => ({ face, name, file, line })),
    )
    .toSorted(
      (one, other) => one.face.localeCompare(other.face) || one.name.localeCompare(other.name),
    );
};
