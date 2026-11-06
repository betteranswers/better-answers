/** A marker is `[^<include id>]` in prose. Code holds none, and a definition opens its line. */
const TOKEN = /(?<!\\)(```[\s\S]*?```|`[^`\n]*`)|\[\^([\w-]+)\]/gu;

const OPENS_A_LINE = /^ {0,3}$/u;

const opensALine = (text: string, at: number): boolean =>
  OPENS_A_LINE.test(text.slice(text.lastIndexOf("\n", at - 1) + 1, at));

export const replaceMarkers = (
  markdown: string,
  replacement: (label: string, at: number) => string,
): string =>
  markdown.replaceAll(
    TOKEN,
    (found: string, code: string | undefined, label: string | undefined, at: number) => {
      if (code !== undefined || label === undefined) return found;
      const defined = markdown[at + found.length] === ":" && opensALine(markdown, at);
      return defined ? found : replacement(label, at);
    },
  );

export const markersOf = (markdown: string): readonly string[] => {
  const labels: string[] = [];
  replaceMarkers(markdown, (label) => {
    labels.push(label);
    return label;
  });
  return labels;
};
