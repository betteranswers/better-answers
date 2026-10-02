/**
 * False when the browser refused: it has no clipboard on an insecure page, and may refuse one to a
 * page without focus.
 */
export const copiedToTheClipboard = (text: string): Promise<boolean> =>
  Promise.resolve()
    .then(() => navigator.clipboard.writeText(text))
    .then(
      () => true,
      () => false,
    );
