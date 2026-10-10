/** The clipboard is the browser's, so a stand-in records what the page wrote to it. */
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
