import { useState } from "react";

import type { WriteOptions } from "@/shared/address/list-address.ts";
import { Button } from "@/shared/ui/button.tsx";

import { useConceptEditing } from "./editing/concept-actions.tsx";
import type { Finished } from "./editing/concept-session.tsx";
import { LAUNCH_WORDS, SEARCH_WORDS as WORDS } from "./knowledge-words.ts";

export type NewConceptHeld = {
  readonly new: string;
  readonly collection: string;
  readonly type: string;
  readonly tags: string;
  readonly subject: string;
};

type Write = (patch: Partial<NewConceptHeld>, options?: WriteOptions) => void;

const OWN_WRITE: WriteOptions = { ignoreBlocker: true };

const CLEARED: NewConceptHeld = { new: "", collection: "", type: "", tags: "", subject: "" };

function NewConceptEditor(properties: {
  readonly held: NewConceptHeld;
  readonly write: Write;
  readonly onFinished: (outcome: Finished) => void;
}) {
  const { held, write } = properties;
  const editing = useConceptEditing({
    target: { kind: "new", collection: held.collection === "" ? undefined : held.collection },
    standing: undefined,
    prefill: {
      title: held.new,
      conceptType: held.type,
      tags: held.tags,
      subject: held.subject,
    },
    startsOpen: true,
    onCollection: (collection) => {
      write({ collection: collection ?? "" }, OWN_WRITE);
    },
    onFinished: (outcome) => {
      properties.onFinished(outcome);
      write(CLEARED, OWN_WRITE);
    },
  });
  return (
    <>
      {editing.actions}
      {editing.status}
      {editing.editor}
    </>
  );
}

export function NewConcept(properties: { readonly held: NewConceptHeld; readonly write: Write }) {
  const open = properties.held.new !== "";
  const [said, setSaid] = useState("");
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSaid("");
  }

  return (
    <div className="mt-6">
      {open ? (
        <NewConceptEditor
          held={properties.held}
          write={properties.write}
          onFinished={(outcome) => {
            setSaid(outcome === "suggested" ? LAUNCH_WORDS.suggestedNew : "");
          }}
        />
      ) : null}
      <output className="block text-muted-foreground empty:hidden">{said}</output>
    </div>
  );
}

export function NewConceptOffer(properties: {
  readonly offered: boolean;
  readonly onOffer: () => void;
}) {
  if (!properties.offered) return null;
  return (
    <div className="border-t border-border px-4 py-3">
      <Button type="button" variant="outline" onClick={properties.onOffer}>
        {WORDS.newConcept}
      </Button>
    </div>
  );
}
