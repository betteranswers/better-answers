import { useId, useState } from "react";

import { CONNECT_ASSISTANT } from "@/app/words.ts";
import { copiedToTheClipboard } from "@/features/auth/clipboard.ts";
import { ASK, headingOf, menuGroupIn, pageNamed } from "@/shared/navigation.ts";
import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { refusedWith } from "@/shared/refusal-outcome.tsx";
import { STOCK } from "@/shared/refusal-words.ts";
import { Button } from "@/shared/ui/button.tsx";

const CONNECT_CLAUDE = pageNamed(menuGroupIn(ASK, "ask"), "Connect Claude");

const ADDRESS = `${window.location.origin}/mcp`;

const copyOutcome = (copied: boolean): Outcome =>
  copied ? { tone: "said", words: CONNECT_ASSISTANT.copied } : refusedWith(STOCK.copy);

export function ConnectClaudePage() {
  const addressId = useId();
  const [outcome, setOutcome] = useState<Outcome | undefined>(undefined);
  const [first, second, ...rest] = CONNECT_ASSISTANT.steps;

  const copy = () => {
    setOutcome(undefined);
    void copiedToTheClipboard(ADDRESS).then((copied) => setOutcome(copyOutcome(copied)));
  };

  return (
    <>
      <h1>{headingOf(CONNECT_CLAUDE)}</h1>
      <h2 className="mt-6">{CONNECT_ASSISTANT.heading}</h2>
      <ol className="mt-3 grid list-decimal gap-3 pl-5">
        <li>
          <p>{first}</p>
        </li>
        <li>
          <p>{second}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <code id={addressId} className="font-mono wrap-anywhere">
              {ADDRESS}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-describedby={addressId}
              onClick={copy}
            >
              {CONNECT_ASSISTANT.copy}
            </Button>
          </div>
          <OutcomeLine outcome={outcome} className="mt-2" />
        </li>
        {rest.map((step) => (
          <li key={step}>
            <p>{step}</p>
          </li>
        ))}
      </ol>
      <p className="mt-4">{CONNECT_ASSISTANT.asYou}</p>
    </>
  );
}
