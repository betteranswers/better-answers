import { Link } from "@tanstack/react-router";
import {
  createContext,
  useContext,
  useId,
  useMemo,
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
} from "react";
import Markdown, { type Components, type ExtraProps, type Options } from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  bodyPartsOf,
  citedMarkdownOf,
  cutAt,
  drawnCuts,
  remarkCitations,
  type BodyPart,
  type Citation,
} from "@better-answers/schema/cited-markdown";
import { linksAndMarksOf, uriDecoded } from "@better-answers/schema/concept-file";

import { cn } from "@/shared/lib/utils.ts";
import { Button } from "@/shared/ui/button.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table.tsx";

import { conceptPageOf } from "./concept-address.ts";
import { CONCEPT_WORDS as WORDS } from "./concept-words.ts";
import { openingOf, type Evidence } from "./knowledge-reads.ts";

type Element = NonNullable<ExtraProps["node"]>;

type Child = Element["children"][number];

type Tree = { readonly type: "root"; readonly children: Child[] };

export type MarkOpening = {
  readonly openerId: string | undefined;
  readonly onOpen: (chosen: { readonly openerId: string; readonly source: number }) => void;
  readonly inline: ReactNode;
};

/** A concept body cut where each of its marks stands, so the page reads no mark from its text. */
const partsOf = (body: string, evidence: readonly Evidence[]): readonly BodyPart[] => {
  const { marks } = linksAndMarksOf(
    body,
    evidence.map((item) => ({ resource: item.source, locator: null, id: item.id ?? null })),
  );
  const spans = marks.map(({ at, mark, source }) => ({ at, end: at + mark.length, cited: source }));
  return bodyPartsOf(drawnCuts(cutAt(body, spans)), (source) => source + 1);
};

type Handlers = NonNullable<NonNullable<Options["remarkRehypeOptions"]>["handlers"]>;

type Handler = NonNullable<Handlers["citation"]>;

/** Markdown's own syntax never makes an element of this name, so only a placed citation is drawn. */
const CITED = "ba-citation";

const citationDrawnAs: Handler = (_state, node: Citation): Element => ({
  type: "element",
  tagName: CITED,
  properties: { dataPlace: node.place },
  children: [],
});

const leftOut: Handler = () => undefined;

type Cited = {
  readonly source: number;
  readonly label: string;
  readonly opens: boolean;
};

type Drawing = {
  readonly cited: readonly Cited[];
  readonly inlineUnder: number | undefined;
};

const text = (value: string): Child => ({ type: "text", value });

const placeOf = (cited: Cited): string => `[${String(cited.source + 1)}]`;

const MARK = "button";

const SLOT = "aside";

const markOf = (drawing: Drawing, mark: number, inLink: boolean): readonly Child[] => {
  const cited = drawing.cited[mark];
  if (cited === undefined) return [];
  if (cited.opens && !inLink) {
    return [{ type: "element", tagName: MARK, properties: { dataMark: mark }, children: [] }];
  }
  return [{ type: "element", tagName: "sup", properties: {}, children: [text(placeOf(cited))] }];
};

type Drawn = {
  readonly nodes: readonly Child[];
  readonly holds: boolean;
  readonly placed: boolean;
};

type Within = { readonly drawing: Drawing; readonly inLink: boolean };

const citationDrawn = (node: Element, { drawing, inLink }: Within): Drawn => {
  const place = Number(node.properties["dataPlace"]);
  return {
    nodes: markOf(drawing, place, inLink),
    holds: !inLink && drawing.inlineUnder === place,
    placed: false,
  };
};

const FLOWS: ReadonlySet<string> = new Set(["li", "blockquote"]);

const BLOCKS: ReadonlySet<string> = new Set([
  "p",
  "ul",
  "ol",
  "blockquote",
  "pre",
  "table",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "section",
]);

const isABlock = (node: Child | undefined): boolean =>
  node?.type === "element" && BLOCKS.has(node.tagName);

const slotAfter = (children: readonly Child[], holder: number): number => {
  if (isABlock(children[holder])) return holder;
  const nextBlock = children.findIndex((child, at) => at > holder && isABlock(child));
  return nextBlock === -1 ? children.length - 1 : nextBlock - 1;
};

const SLOT_NODE: Child = { type: "element", tagName: SLOT, properties: {}, children: [] };

const childrenDrawn = (children: readonly Child[], within: Within, flows: boolean): Drawn => {
  const drawn = children.map((child) => nodeDrawn(child, within));
  const holder = drawn.findIndex((each) => each.holds && !each.placed);
  const nodes = drawn.map((each) => each.nodes);
  if (!flows || holder === -1) {
    return {
      nodes: nodes.flat(),
      holds: drawn.some((each) => each.holds),
      placed: drawn.some((each) => each.placed),
    };
  }
  const after = slotAfter(children, holder) + 1;
  return {
    nodes: [...nodes.slice(0, after).flat(), SLOT_NODE, ...nodes.slice(after).flat()],
    holds: true,
    placed: true,
  };
};

const elementDrawn = (node: Element, within: Within): Drawn => {
  const inside = { ...within, inLink: within.inLink || node.tagName === "a" };
  const drawn = childrenDrawn(node.children, inside, FLOWS.has(node.tagName));
  return { ...drawn, nodes: [{ ...node, children: [...drawn.nodes] }] };
};

const nodeDrawn = (node: Child, within: Within): Drawn => {
  if (node.type !== "element") return { nodes: [node], holds: false, placed: false };
  return node.tagName === CITED ? citationDrawn(node, within) : elementDrawn(node, within);
};

const marksDrawn =
  (drawing: Drawing) =>
  (tree: Tree): Tree => ({
    ...tree,
    children: [...childrenDrawn(tree.children, { drawing, inLink: false }, true).nodes],
  });

type AnsweredLink = { readonly address: string; readonly target: string };

const pagesByAddress = (bodyLinks: readonly AnsweredLink[]): ReadonlyMap<string, string> =>
  new Map(
    bodyLinks.flatMap(({ address, target }) => {
      const page = conceptPageOf(target);
      return page === undefined ? [] : [[uriDecoded(address), page]];
    }),
  );

type Held = {
  readonly cited: readonly Cited[];
  readonly pages: ReadonlyMap<string, string>;
  readonly idOf: (mark: number) => string;
  readonly opening: MarkOpening | undefined;
  readonly headingsFrom: number;
  readonly footnotesId: string;
};

const Body = createContext<Held | undefined>(undefined);

const MARK_LOOK =
  "h-auto min-h-6 min-w-6 px-0.5 py-0 font-mono [font-size:var(--text-xs)] leading-none";

function Mark(properties: ComponentProps<"button"> & ExtraProps) {
  const held = useContext(Body);
  const mark = Number(properties.node?.properties["dataMark"]);
  const cited = held?.cited[mark];
  if (held?.opening === undefined || cited === undefined) return null;
  const { opening } = held;
  const id = held.idOf(mark);
  return (
    <sup>
      <Button
        id={id}
        variant="link"
        aria-expanded={opening.openerId === id}
        aria-label={WORDS.sourceNamed(cited.source + 1, cited.label)}
        className={MARK_LOOK}
        onClick={() => {
          opening.onOpen({ openerId: id, source: cited.source });
        }}
      >
        {placeOf(cited)}
      </Button>
    </sup>
  );
}

function InlinePanel() {
  return useContext(Body)?.opening?.inline ?? null;
}

export const LINK = "text-brand underline underline-offset-4";

const ON_THE_WEB = /^(?:https?:\/\/|mailto:)/u;

const footnoteJump = (node: Element | undefined): "down" | "back" | undefined => {
  if (node?.properties["dataFootnoteRef"] !== undefined) return "down";
  return node?.properties["dataFootnoteBackref"] === undefined ? undefined : "back";
};

const jumpWithinThePage = (event: MouseEvent<HTMLAnchorElement>): void => {
  event.preventDefault();
  const id = decodeURIComponent(new URL(event.currentTarget.href).hash.slice(1));
  const landing = document.getElementById(id);
  (landing?.matches("a") === true ? landing : landing?.querySelector("a"))?.focus();
};

const pageOf = (held: Held | undefined, href: string): string | undefined =>
  held?.pages.get(uriDecoded(href)) ?? conceptPageOf(href);

function BodyLink(properties: ComponentProps<"a"> & ExtraProps) {
  const { href, children, node } = properties;
  const held = useContext(Body);
  if (href === undefined) return children;
  const page = pageOf(held, href);
  if (page !== undefined) {
    return (
      <Link to={page} className={LINK}>
        {children}
      </Link>
    );
  }
  const jump = footnoteJump(node);
  if (jump !== undefined) {
    return (
      <a
        href={href}
        id={properties.id}
        aria-describedby={jump === "down" ? held?.footnotesId : undefined}
        className={LINK}
        onClick={jumpWithinThePage}
      >
        {children}
      </a>
    );
  }
  if (!ON_THE_WEB.test(href.toLowerCase())) return children;
  return (
    <a href={href} rel="noreferrer noopener" className={LINK}>
      {children}
    </a>
  );
}

function AltText(properties: ComponentProps<"img"> & ExtraProps) {
  return properties.alt ?? null;
}

const LEVELS = ["h2", "h3", "h4", "h5", "h6"] as const;

const FOOTNOTE_LABEL = "footnote-label";

const headingAt = (depth: number) => (properties: ComponentProps<"h1"> & ExtraProps) => {
  const held = useContext(Body);
  const level = (held?.headingsFrom ?? 2) + Math.max(0, depth - 2);
  const Level = LEVELS[Math.min(level, 6) - 2] ?? "h6";
  const isTheFootnotesLabel = properties.id === FOOTNOTE_LABEL;
  return (
    <Level
      id={isTheFootnotesLabel ? held?.footnotesId : properties.id}
      className="font-semibold [font-size:var(--text-md)]"
    >
      {properties.children}
    </Level>
  );
};

/** The parser passes each component its syntax-tree node, which is not a valid DOM attribute. */
const withoutNode = <Properties extends ExtraProps>({
  node: _node,
  ...rest
}: Properties): Omit<Properties, "node"> => rest;

const COMPONENTS: Components = {
  a: BodyLink,
  img: AltText,
  [MARK]: Mark,
  [SLOT]: InlinePanel,
  h1: headingAt(1),
  h2: headingAt(2),
  h3: headingAt(3),
  h4: headingAt(4),
  h5: headingAt(5),
  h6: headingAt(6),
  table: (properties) => <Table {...withoutNode(properties)} />,
  thead: (properties) => <TableHeader {...withoutNode(properties)} />,
  tbody: (properties) => <TableBody {...withoutNode(properties)} />,
  tr: (properties) => <TableRow {...withoutNode(properties)} />,
  th: (properties) => <TableHead {...withoutNode(properties)} />,
  td: (properties) => <TableCell {...withoutNode(properties)} />,
};

const PROSE = cn(
  "max-w-measure-reading text-pretty wrap-anywhere",
  "[font-size:var(--prose-size,var(--text-lg))] [line-height:var(--prose-leading,var(--leading-prose))]",
  "[&>*+*]:mt-4 [&_li>*+*]:mt-2 [&_li+li]:mt-1",
  "[&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6",
  "[&_blockquote]:border-l [&_blockquote]:border-border [&_blockquote]:pl-4",
  "[&_code]:font-mono [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:whitespace-pre-wrap",
  "[&_hr]:border-border [&_td]:whitespace-normal [&_th]:whitespace-normal",
);

/** An id is safe in an address's fragment only as letters, digits and dashes. */
const fragmentSafe = (id: string): string => id.replaceAll(/[^A-Za-z0-9_-]/gu, "");

type BodyProperties = {
  readonly evidence: readonly Evidence[];
  readonly bodyLinks?: readonly AnsweredLink[];
  readonly opening?: MarkOpening;
  readonly headingsFrom?: number;
};

const citedIn = (
  parts: readonly BodyPart[],
  evidence: readonly Evidence[],
  opening: MarkOpening | undefined,
): readonly Cited[] =>
  parts.flatMap((part) => {
    if (part.kind === "text") return [];
    const source = part.number - 1;
    return [
      {
        source,
        label: evidence[source]?.source ?? "",
        opens: opening !== undefined && openingOf(evidence[source]) !== undefined,
      },
    ];
  });

function CitedBody(
  properties: BodyProperties & {
    readonly parts: readonly BodyPart[];
    readonly handlers: Handlers;
  },
) {
  const { parts, evidence, bodyLinks, opening, headingsFrom = 2 } = properties;
  const baseId = fragmentSafe(useId());

  const cited = useMemo(() => citedMarkdownOf(parts), [parts]);

  const pages = useMemo(() => pagesByAddress(bodyLinks ?? []), [bodyLinks]);

  const held = useMemo<Held>(
    () => ({
      pages,
      cited: citedIn(parts, evidence, opening),
      idOf: (mark) => `${baseId}-mark-${String(mark)}`,
      opening,
      headingsFrom,
      footnotesId: `${baseId}-footnotes`,
    }),
    [pages, parts, evidence, opening, headingsFrom, baseId],
  );

  const opened = held.cited.findIndex((_, mark) => opening?.openerId === held.idOf(mark));
  const drawing: Drawing = {
    cited: held.cited,
    inlineUnder: opened === -1 || opening?.inline == null ? undefined : opened,
  };

  return (
    <Body value={held}>
      <div className={PROSE}>
        <Markdown
          remarkPlugins={[remarkGfm, [remarkCitations, cited.citations]]}
          rehypePlugins={[[marksDrawn, drawing]]}
          remarkRehypeOptions={{
            footnoteLabel: WORDS.footnotes,
            footnoteLabelProperties: {},
            footnoteBackContent: WORDS.backToTheClaim,
            clobberPrefix: `${baseId}-`,
            handlers: properties.handlers,
          }}
          components={COMPONENTS}
        >
          {cited.markdown}
        </Markdown>
      </div>
    </Body>
  );
}

const CONCEPT_HANDLERS: Handlers = { citation: citationDrawnAs };

export function ConceptBody(properties: BodyProperties & { readonly body: string }) {
  const { body, evidence } = properties;
  const parts = useMemo(() => partsOf(body, evidence), [body, evidence]);
  return <CitedBody {...properties} parts={parts} handlers={CONCEPT_HANDLERS} />;
}

/** A Brief cites only through its parts. A footnote typed in its text is drawn as nothing, as the copy does. */
const BRIEF_HANDLERS: Handlers = {
  citation: citationDrawnAs,
  footnoteReference: leftOut,
  footnoteDefinition: leftOut,
};

export function CitedBrief(
  properties: Pick<BodyProperties, "evidence" | "headingsFrom"> & {
    readonly parts: readonly BodyPart[];
  },
) {
  return <CitedBody {...properties} handlers={BRIEF_HANDLERS} />;
}
