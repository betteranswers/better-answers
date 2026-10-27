import path from "node:path";

import {
  type ArrowFunctionExpression,
  type CallExpression,
  type Declaration,
  type Directive,
  type ExportAllDeclaration,
  type ExportNamedDeclaration,
  type Expression,
  type Function as FunctionNode,
  type ImportDeclaration,
  type ModuleExportName,
  type Program,
  type Span,
  type Statement,
  type TSTypeReference,
  Visitor,
} from "oxc-parser";

import { parsedSource } from "./parsed-source.ts";

const FITS_ANY_PERSON: ReadonlySet<string> = new Set(["UserPrincipal", "Principal", "AdmittedOf"]);

const ADMIT = "admit";

const FACE_FILE = "index.ts";

type SourcesByPosixPath = Readonly<Record<string, string>>;

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
  readonly own: ReadonlyMap<string, Found>;
  readonly named: readonly ReExport[];
  readonly whole: readonly string[];
};

const within = (outer: Span, at: number): boolean => outer.start <= at && at < outer.end;

const namesAPerson = ({ typeName }: TSTypeReference): boolean => {
  if (typeName.type === "Identifier") return FITS_ANY_PERSON.has(typeName.name);
  return typeName.type === "TSQualifiedName" && FITS_ANY_PERSON.has(typeName.right.name);
};

const passesADeclaration = ({ callee, arguments: [first] }: CallExpression): boolean =>
  callee.type === "Identifier" && callee.name === ADMIT && first?.type === "Identifier";

type Marks = {
  readonly admissions: readonly number[];

  readonly people: readonly number[];
};

const marksOf = (program: Program): Marks => {
  const admissions: number[] = [];
  const named: number[] = [];
  const callbacks: Span[] = [];
  new Visitor({
    CallExpression: (node) => {
      if (passesADeclaration(node)) admissions.push(node.start);
    },
    TSTypeReference: (node) => {
      if (namesAPerson(node)) named.push(node.start);
    },
    TSFunctionType: (node) => {
      callbacks.push(node);
    },
    TSConstructorType: (node) => {
      callbacks.push(node);
    },
  }).visit(program);
  return {
    admissions,
    people: named.filter((at) => !callbacks.some((callback) => within(callback, at))),
  };
};

const functionOf = (init: Expression | null): FunctionShape | undefined => {
  if (init === null) return undefined;
  if (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression") return init;
  if (
    init.type === "ParenthesizedExpression" ||
    init.type === "TSAsExpression" ||
    init.type === "TSNonNullExpression" ||
    init.type === "TSSatisfiesExpression"
  ) {
    return functionOf(init.expression);
  }
  return undefined;
};

const declaredBy = (declaration: Declaration | Statement | Directive): readonly Declared[] => {
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

type Imported = { readonly local: string; readonly from: string };

const importedBy = ({
  importKind,
  source,
  specifiers,
}: ImportDeclaration): readonly (readonly [string, Imported])[] =>
  importKind === "type"
    ? []
    : specifiers.flatMap((specifier) =>
        specifier.type === "ImportSpecifier" && specifier.importKind !== "type"
          ? [[specifier.local.name, { local: nameOf(specifier.imported), from: source.value }]]
          : [],
      );

const isBeside = (specifier: string): boolean => specifier.startsWith("./");

type Reading = {
  readonly file: string;
  readonly lineOf: (offset: number) => number;
  readonly marks: Marks;
  readonly functions: Map<string, Found>;
  readonly imports: Map<string, Imported>;

  readonly exported: Map<string, string>;
  readonly named: ReExport[];
  readonly whole: string[];
};

const takesAPerson = ({ people }: Marks, { params, typeParameters }: FunctionShape): boolean =>
  [...params, ...(typeParameters?.params ?? [])].some((typed) =>
    people.some((at) => within(typed, at)),
  );

const declare = (
  reading: Reading,
  declaration: Declaration | Statement | Directive,
  isExported: boolean,
): void => {
  const { file, lineOf, marks } = reading;
  for (const { name, at, node } of declaredBy(declaration)) {
    reading.functions.set(name, {
      file,
      line: lineOf(at),
      takesAPerson: takesAPerson(marks, node),
      admits: marks.admissions.some((call) => within(node, call)),
    });
    if (isExported) reading.exported.set(name, name);
  }
};

const exportNamed = (reading: Reading, statement: ExportNamedDeclaration): void => {
  if (statement.declaration !== null) declare(reading, statement.declaration, true);
  const from = statement.source?.value;
  for (const { name, local } of listedBy(statement)) {
    if (from === undefined) reading.exported.set(name, local);
    else reading.named.push({ name, local, from });
  }
};

const unread = (file: string, form: string): never => {
  throw new Error(`${file} has ${form}, which the face reader does not follow`);
};

const exportWhole = (reading: Reading, statement: ExportAllDeclaration): void => {
  if (statement.exportKind === "type" || !isBeside(statement.source.value)) return;
  if (statement.exported !== null) unread(reading.file, "a namespace re-export");
  reading.whole.push(statement.source.value);
};

const readStatement = (reading: Reading, statement: Statement | Directive): void => {
  if (statement.type === "ImportDeclaration") {
    for (const [local, imported] of importedBy(statement)) reading.imports.set(local, imported);
  } else if (statement.type === "ExportNamedDeclaration") {
    exportNamed(reading, statement);
  } else if (statement.type === "ExportDefaultDeclaration") {
    unread(reading.file, "a default export");
  } else if (statement.type === "ExportAllDeclaration") {
    exportWhole(reading, statement);
  } else {
    declare(reading, statement, false);
  }
};

const moduleOf = (file: string, source: string): Module => {
  const { program, lineOf } = parsedSource(file, source);
  const reading: Reading = {
    file,
    lineOf,
    marks: marksOf(program),
    functions: new Map(),
    imports: new Map(),
    exported: new Map(),
    named: [],
    whole: [],
  };
  for (const statement of program.body) readStatement(reading, statement);

  const own = new Map<string, Found>();
  for (const [name, local] of reading.exported) {
    const declared = reading.functions.get(local);
    const imported = reading.imports.get(local);
    if (declared !== undefined) own.set(name, declared);
    else if (imported !== undefined) reading.named.push({ name, ...imported });
  }
  return { own, named: reading.named.filter(({ from }) => isBeside(from)), whole: reading.whole };
};

const beside = (file: string, specifier: string): string =>
  path.posix.join(path.posix.dirname(file), specifier);

export const facesAdmittingNobody = (
  sources: SourcesByPosixPath,
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
    for (const from of whole) {
      for (const [name, declared] of exportedFrom(beside(file, from))) {
        if (!found.has(name)) found.set(name, declared);
      }
    }
    for (const { name, local, from } of named) {
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
