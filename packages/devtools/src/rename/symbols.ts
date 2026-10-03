import { Node, SyntaxKind } from "ts-morph";
import type { Identifier, Project, Symbol as MorphSymbol } from "ts-morph";

import { OUTSIDE_ALLOWLIST, RENAMED, isSwept, relativeTo } from "./edits.ts";
import type { Edit, Occurrence, PassOutcome } from "./edits.ts";
import { inAllowlist, keptReason, senseOf } from "./map.ts";
import type { RenameMap } from "./map.ts";
import { projectAt } from "./project.ts";
import { renamedText, wordSource } from "./words.ts";
import type { Words } from "./words.ts";

const DECLARED_OUTSIDE = "declared outside the tree";

const ALIASED = "aliased import, renamed by hand";

type Context = {
  readonly root: string;
  readonly map: RenameMap;
  readonly words: Words;
  readonly project: Project;
};

type Site = {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly found: string;
  readonly start: number;
  readonly end: number;
};

const fileOf = (root: string, node: Node): string =>
  relativeTo(root, node.getSourceFile().getFilePath());

const isOwned = (root: string, node: Node): boolean => isSwept(fileOf(root, node));

/** A module's own declaration is its file, which a rename cannot move. */
const ownedDeclaration = (root: string, symbol: MorphSymbol | undefined): Node | undefined =>
  symbol
    ?.getDeclarations()
    .find((declaration) => !Node.isSourceFile(declaration) && isOwned(root, declaration));

const importsOwnModule = (root: string, alias: MorphSymbol): boolean =>
  alias.getDeclarations().some((declaration) => {
    const statement =
      declaration.getFirstAncestorByKind(SyntaxKind.ImportDeclaration) ??
      declaration.getFirstAncestorByKind(SyntaxKind.ExportDeclaration);
    const module = statement?.getModuleSpecifierSourceFile();
    return module !== undefined && isOwned(root, module);
  });

/** An import is its own home when it names a whole module, or an export of ours a sweep renamed. */
const staysWithAlias = (
  root: string,
  alias: MorphSymbol,
  target: MorphSymbol | undefined,
): boolean => {
  const declarations = target?.getDeclarations() ?? [];
  return declarations.length === 0
    ? importsOwnModule(root, alias)
    : declarations.some((declaration) => Node.isSourceFile(declaration));
};

/** The declaration a rename starts from, or undefined when the symbol is not this tree's own. */
const homeOf = (root: string, identifier: Identifier): Node | undefined => {
  const symbol = identifier.getSymbol();
  if (symbol === undefined) return undefined;
  if (!symbol.isAlias()) return ownedDeclaration(root, symbol);
  const target = symbol.getAliasedSymbol();
  return (
    ownedDeclaration(root, target) ??
    (staysWithAlias(root, symbol, target) ? ownedDeclaration(root, symbol) : undefined)
  );
};

const siteOf = (root: string, identifier: Identifier): Site => {
  const sourceFile = identifier.getSourceFile();
  const start = identifier.getStart();
  const { line, column } = sourceFile.getLineAndColumnAtPos(start);
  return {
    file: fileOf(root, sourceFile),
    line,
    column,
    found: identifier.getText(),
    start,
    end: identifier.getEnd(),
  };
};

const candidatesIn = (context: Context): readonly Identifier[] => {
  const narrow = new RegExp(wordSource(context.words), "i");
  return context.project
    .getSourceFiles()
    .filter((file) => isOwned(context.root, file) && narrow.test(file.getFullText()))
    .flatMap((file) => file.getDescendantsOfKind(SyntaxKind.Identifier))
    .filter(
      (identifier) => renamedText(identifier.getText(), context.words) !== identifier.getText(),
    );
};

const homeVerdict = (context: Context, home: Node, found: string): string => {
  const file = fileOf(context.root, home);
  return (
    keptReason(file) ??
    senseOf(context.map, file, found) ??
    (inAllowlist(context.map.symbols.paths, file) ? RENAMED : OUTSIDE_ALLOWLIST)
  );
};

const locatedEdits = (context: Context, home: Node, to: string): readonly Edit[] => {
  const name = Node.hasName(home) ? home.getNameNode() : home;
  return context.project
    .getLanguageService()
    .findRenameLocations(name, { usePrefixAndSuffixText: false })
    .map((location) => ({
      file: fileOf(context.root, location.getSourceFile()),
      start: location.getTextSpan().getStart(),
      end: location.getTextSpan().getEnd(),
      text: to,
    }));
};

/** The language service names every reference; the sites stand in where it declines, as for an unresolved import. */
const renameEdits = (
  context: Context,
  home: Node,
  sites: readonly Site[],
  to: string,
): readonly Edit[] => {
  const located = locatedEdits(context, home, to);
  return located.length > 0
    ? located
    : sites.map((site) => ({ file: site.file, start: site.start, end: site.end, text: to }));
};

type Settled = { readonly verdict: string; readonly edits: readonly Edit[] };

/** Renaming from the target would give it the alias's new name; whether the alias or the export moves is a person's call. */
const isAliased = (home: Node, sites: readonly Site[]): boolean => {
  const name = Node.hasName(home) ? home.getName() : sites[0]?.found;
  return sites.some((site) => site.found !== name);
};

/** A rename that would reach a kept file is refused whole, since half of one would not compile. */
const settled = (context: Context, home: Node, sites: readonly Site[]): Settled => {
  const found = sites[0]?.found ?? "";
  const verdict = homeVerdict(context, home, found);
  if (verdict !== RENAMED) return { verdict, edits: [] };
  if (isAliased(home, sites)) return { verdict: ALIASED, edits: [] };
  const edits = renameEdits(context, home, sites, renamedText(found, context.words));
  const reached = edits.map((edit) => keptReason(edit.file)).find((reason) => reason !== undefined);
  return reached === undefined ? { verdict, edits } : { verdict: reached, edits: [] };
};

const occurrenceAt = (context: Context, site: Site, verdict: string): Occurrence => {
  const kept = keptReason(site.file) ?? verdict;
  return {
    pass: "symbol",
    file: site.file,
    line: site.line,
    column: site.column,
    found: site.found,
    to: kept === RENAMED ? renamedText(site.found, context.words) : site.found,
    verdict: kept,
  };
};

const strayVerdict = (context: Context, site: Site): string =>
  keptReason(site.file) ?? senseOf(context.map, site.file, site.found) ?? DECLARED_OUTSIDE;

/** Inventories every identifier holding an old word and the edits that rename this tree's own. */
export const symbolPass = (root: string, map: RenameMap, words: Words): PassOutcome => {
  const context: Context = { root, map, words, project: projectAt(root) };
  const homes = new Map<Node, Site[]>();
  const strays: Site[] = [];
  for (const identifier of candidatesIn(context)) {
    const home = homeOf(root, identifier);
    const site = siteOf(root, identifier);
    if (home === undefined) {
      strays.push(site);
      continue;
    }
    const atHome = homes.get(home) ?? [];
    atHome.push(site);
    homes.set(home, atHome);
  }

  const occurrences = strays.map((site) =>
    occurrenceAt(context, site, strayVerdict(context, site)),
  );
  const edits: Edit[] = [];
  for (const [home, sites] of homes) {
    const outcome = settled(context, home, sites);
    occurrences.push(...sites.map((site) => occurrenceAt(context, site, outcome.verdict)));
    edits.push(...outcome.edits);
  }
  return { occurrences, edits };
};
