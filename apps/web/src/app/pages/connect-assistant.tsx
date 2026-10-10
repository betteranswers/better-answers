import { useId, useState } from "react";

import { ADDRESS_NOT_COPIED, CONNECT_ASSISTANT } from "@/app/words.ts";
import { copiedToTheClipboard } from "@/features/auth/clipboard.ts";
import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { refusedWith } from "@/shared/refusal-outcome.tsx";
import { Button } from "@/shared/ui/button.tsx";

/** The api serves this page only on its public origin, which is the resource's origin too. */
const ADDRESS = `${window.location.origin}/mcp`;

const copyOutcome = (copied: boolean): Outcome =>
  copied ? { tone: "said", words: CONNECT_ASSISTANT.copied } : refusedWith(ADDRESS_NOT_COPIED);

export function ConnectAssistant() {
  const addressId = useId();
  const [outcome, setOutcome] = useState<Outcome | undefined>(undefined);
  const [first, second, third] = CONNECT_ASSISTANT.steps;

  const copy = () => {
    setOutcome(undefined);
    void copiedToTheClipboard(ADDRESS).then((copied) => setOutcome(copyOutcome(copied)));
  };

  return (
    <>
      <h2 className="mt-8">{CONNECT_ASSISTANT.heading}</h2>
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
        <li>
          <p>{third}</p>
        </li>
      </ol>
      <p className="mt-4">{CONNECT_ASSISTANT.asYou}</p>
    </>
  );
}
