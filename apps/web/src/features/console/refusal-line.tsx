import type { RefusalWord } from "@/shared/api/trpc.ts";

import type { Said } from "./words.ts";

/** The api's word as itself, then why and what the reader can do next. */
export function RefusalLine(properties: {
  readonly word: RefusalWord | undefined;
  readonly said: Said;
}) {
  const { word, said } = properties;

  return (
    <>
      {word === undefined ? null : (
        <>
          Refused: <code className="font-mono">{word}</code>.{" "}
        </>
      )}
      {said.why} {said.next}
    </>
  );
}
