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
import Markdown, { type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";

import { linksAndMarksOf } from "@better-answers/schema/concept-file";

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

const OPENS = "\uE000";

const CLOSES = "\uE001";

const carrierOf = (mark: number): string => `<${OPENS}${String(mark)}${CLOSES}>`;

const CARRIED = new RegExp(`<${OPENS}(\\d+)${CLOSES}>`);

const FORGED = new RegExp(`[${OPENS}${CLOSES}]|&#(?:x0*e00[01]|0*5734[45]);`, "gi");

const unforged = (words: string): string => words.replaceAll(FORGED, "");

type Placed = { readonly at: number; readonly mark: string };

const carrying = (body: string, marks: readonly Placed[]): string => {
  const pieces: string[] = [];
  let from = 0;
  for (const [place, { at, mark }] of marks.entries()) {
    pieces.push(unforged(body.slice(from, at)), carrierOf(place));
    from = at + mark.length;
  }
  pieces.push(unforged(body.slice(from)));
  return pieces.join("");
};

const CARRIED_IN_AN_ADDRESS = new RegExp(
  `(?:<|%3C)(?:${OPENS}|%EE%80%80)\\d+(?:${CLOSES}|%EE%80%81)(?:>|%3E)`,
  "gi",
);

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

const wordsDrawn = (value: string, within: Within): Drawn => {
  const { drawing, inLink } = within;
  const pieces = value.split(CARRIED);
  const marks = pieces.flatMap((piece, at) => (at % 2 === 1 ? [Number(piece)] : []));
  return {
    nodes: pieces.flatMap((piece, at) =>
      at % 2 === 1 ? markOf(drawing, Number(piece), inLink) : piece === "" ? [] : [text(piece)],
    ),
    holds: !inLink && drawing.inlineUnder !== undefined && marks.includes(drawing.inlineUnder),
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

const withItsOwnAddress = (link: Element): Element => {
  const { href } = link.properties;
  if (typeof href !== "string") return link;
  return {
    ...link,
    properties: { ...link.properties, href: href.replaceAll(CARRIED_IN_AN_ADDRESS, "") },
  };
};

const elementDrawn = (node: Element, within: Within): Drawn => {
  const isALink = node.tagName === "a";
  const inside = { ...within, inLink: within.inLink || isALink };
  const drawn = childrenDrawn(node.children, inside, FLOWS.has(node.tagName));
  const element = isALink ? withItsOwnAddress(node) : node;
  return { ...drawn, nodes: [{ ...element, children: [...drawn.nodes] }] };
};

const nodeDrawn = (node: Child, within: Within): Drawn => {
  if (node.type === "element") return elementDrawn(node, within);
  if (node.type === "text" || node.type === "raw") return wordsDrawn(node.value, within);
  return { nodes: [node], holds: false, placed: false };
};

const marksDrawn =
  (drawing: Drawing) =>
  (tree: Tree): Tree => ({
    ...tree,
    children: [...childrenDrawn(tree.children, { drawing, inLink: false }, true).nodes],
  });

const decoded = (address: string): string => {
  try {
    return decodeURI(address);
  } catch {
    return address;
  }
};

type AnsweredLink = { readonly address: string; readonly target: string };

const pagesByAddress = (bodyLinks: readonly AnsweredLink[]): ReadonlyMap<string, string> =>
  new Map(
    bodyLinks.flatMap(({ address, target }) => {
      const page = conceptPageOf(target);
      return page === undefined ? [] : [[decoded(address), page]];
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

const ON_THE_WEB = /^(?:https?:\/\/|mailto:)/i;

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
  held?.pages.get(decoded(href)) ?? conceptPageOf(href);

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
  if (!ON_THE_WEB.test(href)) return children;
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
  const level = (held?.headingsFrom ?? 3) + Math.max(0, depth - 2);
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

/** The parser hands each part its node, which is no attribute of the element drawn. */
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

const PLUGINS = [remarkGfm];

const PROSE = cn(
  "max-w-measure wrap-anywhere",
  "[font-size:var(--prose-size,var(--text-lg))] [line-height:var(--prose-leading,var(--leading-prose))]",
  "[&>*+*]:mt-4 [&_li>*+*]:mt-2 [&_li+li]:mt-1",
  "[&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6",
  "[&_blockquote]:border-l [&_blockquote]:border-border [&_blockquote]:pl-4",
  "[&_code]:font-mono [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:whitespace-pre-wrap",
  "[&_hr]:border-border [&_td]:whitespace-normal [&_th]:whitespace-normal",
);

/** An id is safe in an address's fragment only as letters, digits and dashes. */
const fragmentSafe = (id: string): string => id.replaceAll(/[^A-Za-z0-9_-]/g, "");

export function ConceptBody(properties: {
  readonly body: string;
  readonly evidence: readonly Evidence[];
  readonly bodyLinks?: readonly AnsweredLink[];
  readonly opening?: MarkOpening;
  readonly headingsFrom?: number;
}) {
  const { body, evidence, bodyLinks, opening, headingsFrom = 3 } = properties;
  const baseId = fragmentSafe(useId());

  const read = useMemo(() => {
    const { marks } = linksAndMarksOf(
      body,
      evidence.map((item) => ({ resource: item.source, locator: null, id: item.id ?? null })),
    );
    return { text: carrying(body, marks), marks };
  }, [body, evidence]);

  const pages = useMemo(() => pagesByAddress(bodyLinks ?? []), [bodyLinks]);

  const held: Held = {
    pages,
    cited: read.marks.map(({ source }) => ({
      source,
      label: evidence[source]?.source ?? "",
      opens: opening !== undefined && openingOf(evidence[source]) !== undefined,
    })),
    idOf: (mark) => `${baseId}-mark-${String(mark)}`,
    opening,
    headingsFrom,
    footnotesId: `${baseId}-footnotes`,
  };

  const opened = held.cited.findIndex((_, mark) => opening?.openerId === held.idOf(mark));
  const drawing: Drawing = {
    cited: held.cited,
    inlineUnder: opened === -1 || opening?.inline == null ? undefined : opened,
  };

  return (
    <Body value={held}>
      <div className={PROSE}>
        <Markdown
          remarkPlugins={PLUGINS}
          rehypePlugins={[[marksDrawn, drawing]]}
          remarkRehypeOptions={{
            footnoteLabel: WORDS.footnotes,
            footnoteLabelProperties: {},
            footnoteBackContent: WORDS.backToTheClaim,
            clobberPrefix: `${baseId}-`,
          }}
          components={COMPONENTS}
        >
          {read.text}
        </Markdown>
      </div>
    </Body>
  );
}
