import { BRIEF_MARKER } from "@better-answers/schema/brief-marker";

export type Footnote = {
  readonly label: string;
  readonly iri: string;
  readonly title: string;
};

type NumberedFootnote = Footnote & { readonly number: number };

export type RenderedBrief = {
  readonly markdown: string;
  readonly footnotes: readonly NumberedFootnote[];
};

const page = (markdown: string, footnotes: readonly Footnote[]): RenderedBrief => {
  const byLabel = new Map(footnotes.map((footnote) => [footnote.label, footnote]));
  const numbered = new Map<string, NumberedFootnote>();
  const text = markdown.replaceAll(BRIEF_MARKER, (_marker, label: string) => {
    const footnote = byLabel.get(label);
    if (footnote === undefined) return "";
    const cited = numbered.get(label) ?? { ...footnote, number: numbered.size + 1 };
    numbered.set(label, cited);
    return `[^${String(cited.number)}]`;
  });
  return { markdown: text, footnotes: [...numbered.values()] };
};

const PROFILES = { page } as const satisfies Record<
  string,
  (markdown: string, footnotes: readonly Footnote[]) => RenderedBrief
>;

type Profile = keyof typeof PROFILES;

export const renderBrief = (
  markdown: string,
  footnotes: readonly Footnote[],
  profile: Profile,
): RenderedBrief => PROFILES[profile](markdown, footnotes);
