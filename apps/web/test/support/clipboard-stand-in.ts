export const clipboardAnswering = (answer: () => Promise<void>): readonly string[] => {
  const written: string[] = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (text: string) => {
        written.push(text);
        return answer();
      },
    },
  });
  return written;
};

type Item = { readonly parts: Readonly<Record<string, Promise<Blob>>> };

class StoodInItem implements Item {
  readonly parts: Readonly<Record<string, Promise<Blob>>>;

  constructor(parts: Readonly<Record<string, Promise<Blob>>>) {
    this.parts = parts;
  }
}

export const clipboardTaking = (
  answer: () => Promise<void> = () => Promise.resolve(),
): readonly Item[] => {
  const taken: Item[] = [];
  Object.defineProperty(globalThis, "ClipboardItem", { configurable: true, value: StoodInItem });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      write: (items: readonly Item[]) => {
        taken.push(...items);
        return answer();
      },
    },
  });
  return taken;
};

export const partOf = async (item: Item | undefined, type: string): Promise<string> => {
  const part = item?.parts[type];
  if (part === undefined) throw new Error(`the clipboard item has no ${type}`);
  return (await part).text();
};
