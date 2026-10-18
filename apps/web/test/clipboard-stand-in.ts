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
