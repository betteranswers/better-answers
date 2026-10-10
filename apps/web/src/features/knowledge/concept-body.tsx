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
import { openingOf, type Evidence } from "./knowledge-api.ts";
import { CONCEPT_WORDS as WORDS } from "./knowledge-words.ts";

type Element = NonNullable<ExtraProps["node"]>;

type Child = Element["children"][number];

type Tree = { readonly type: "root"; readonly children: Child[] };

export type MarkOpening = {
  /** The control whose panel is open: one of this body's marks, or a control elsewhere on the page. */
  readonly openerId: string | undefined;
  readonly onOpen: (chosen: { readonly openerId: string; readonly source: number }) => void;
  /** The panel, where it is drawn under the open mark's own block instead of beside the page. */
  readonly inline: ReactNode;
};

const OPENS = "\uE000";

const CLOSES = "\uE001";

/** Punctuation, as the mark's own bracket was, so emphasis before it closes and a bare address ends. */
const carrierOf = (mark: number): string => `<${OPENS}${String(mark)}${CLOSES}>`;

const CARRIED = new RegExp(`<${OPENS}(\\d+)${CLOSES}>`);

/** The carrier's two characters, written out or as the character references the parser would decode. */
const FORGED = new RegExp(`[${OPENS}${CLOSES}]|&#(?:x0*e00[01]|0*5734[45]);`, "gi");

/** The file's own words can never carry a mark: only a place the one reader found does. */
const unforged = (words: string): string => words.replaceAll(FORGED, "");

type Placed = { readonly at: number; readonly mark: string };

/** Marks come in the body's order, each read from the body as the file wrote it. */
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

/** A destination that ends in a mark took the carrier with it; the address is the file's without it. */
const CARRIED_IN_AN_ADDRESS = new RegExp(
  `(?:<|%3C)(?:${OPENS}|%EE%80%80)\\d+(?:${CLOSES}|%EE%80%81)(?:>|%3E)`,
  "gi",
);

type Cited = {
  readonly source: number;
  readonly label: string;
  /** False where the reader may open nothing, and everywhere in a body no panel opens from. */
  readonly opens: boolean;
};

type Drawing = {
  readonly cited: readonly Cited[];
  /** The mark whose panel is drawn under its block. */
  readonly inlineUnder: number | undefined;
};

const text = (value: string): Child => ({ type: "text", value });

const placeOf = (cited: Cited): string => `[${String(cited.source + 1)}]`;

const MARK = "button";

const SLOT = "aside";

/** A mark inside a link stays text: a control inside a link is no control. */
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
  /** Whether the mark the panel sits under is in here, and whether the panel already is. */
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

/** Where prose flows as blocks, so a panel can sit between two of them. */
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

/** After the block that holds the mark; in a line of loose words, after the last of them. */
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

/** Raw HTML is drawn as the text the file wrote, so a mark inside it is still a mark. */
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

/** The parser percent-encodes what the file wrote plainly, so both sides are compared decoded. */
const decoded = (address: string): string => {
  try {
    // Not `decodeURIComponent`: an encoded slash or hash is no slash or hash of the file's.
    return decodeURI(address);
  } catch {
    // No percent-encoding of anything, so the address stands as the file wrote it.
    return address;
  }
};

/** A link the read answered: the address the body wrote, and the concept it leads to. */
type AnsweredLink = { readonly address: string; readonly target: string };

/** The concept page each answered address leads to; the address itself is never a destination. */
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

/** The file's own addresses on the web, and nothing a browser would run or resolve against this site. */
const ON_THE_WEB = /^(?:https?:\/\/|mailto:)/i;

/** A footnote's own link down to its note, or back up to the claim. */
const footnoteJump = (node: Element | undefined): "down" | "back" | undefined => {
  if (node?.properties["dataFootnoteRef"] !== undefined) return "down";
  return node?.properties["dataFootnoteBackref"] === undefined ? undefined : "back";
};

/** Focus moves within the page and the address stays, so Back still leaves the page. */
const jumpWithinThePage = (event: MouseEvent<HTMLAnchorElement>): void => {
  event.preventDefault();
  const id = decodeURIComponent(new URL(event.currentTarget.href).hash.slice(1));
  const landing = document.getElementById(id);
  (landing?.matches("a") === true ? landing : landing?.querySelector("a"))?.focus();
};

/** Where an answered address leads, else where a concept's own IRI does. */
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

/** Never fetched: a remote image would tell its host who read which concept. */
function AltText(properties: ComponentProps<"img"> & ExtraProps) {
  return properties.alt ?? null;
}

const LEVELS = ["h2", "h3", "h4", "h5", "h6"] as const;

const FOOTNOTE_LABEL = "footnote-label";

/** The body sits under the page's own headings, so its first level is the one beneath them. */
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

/** Raw HTML is drawn as text and an image as its alt text; a mark takes its source's number. */
export function ConceptBody(properties: {
  readonly body: string;
  readonly evidence: readonly Evidence[];
  /** The body's links the read answered. Absent, every relative link is drawn as its words. */
  readonly bodyLinks?: readonly AnsweredLink[];
  /** Absent where a mark opens nothing, as in the panel: one level only. */
  readonly opening?: MarkOpening;
  /** The heading level the body's own first level takes. */
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
