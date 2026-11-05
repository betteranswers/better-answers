import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import type { BodyField } from "./visual-body.tsx";

const FIELD_HEIGHT = "12rem";

const SELECTED = "color-mix(in srgb, var(--ring) 28%, transparent)";

const THEME = EditorView.theme({
  "&": {
    minHeight: FIELD_HEIGHT,
    maxWidth: "100%",
    color: "var(--foreground)",
    backgroundColor: "var(--background)",
    border: "1px solid var(--input)",
    fontSize: "var(--text-base)",
  },
  "&.cm-focused": { outline: "none", boxShadow: "var(--focus-ring)" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "var(--leading-relaxed)" },
  ".cm-content": { minHeight: FIELD_HEIGHT, padding: "var(--space-2) 0" },
  ".cm-line": { padding: "0 var(--space-3)" },
  "&.cm-editor .cm-cursor, &.cm-editor .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
  "&.cm-editor .cm-selectionBackground": { backgroundColor: SELECTED },
  "&.cm-editor.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
    backgroundColor: SELECTED,
  },
});

const attributesOf = (label: string, describedBy: string | undefined) => {
  const attributes = { role: "textbox", "aria-multiline": "true", "aria-label": label };
  return EditorView.contentAttributes.of(
    describedBy === undefined ? attributes : { ...attributes, "aria-describedby": describedBy },
  );
};

export function SourceBody(properties: BodyField) {
  const { label, describedBy } = properties;
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(null);
  const [attributes] = useState(() => new Compartment());
  const [initial] = useState(properties.value);
  const changed = useEffectEvent((text: string) => {
    properties.onChange(text);
  });

  useEffect(() => {
    const parent = host.current;
    if (parent === null) return;
    const created = new EditorView({
      parent,
      state: EditorState.create({
        doc: initial,
        extensions: [
          markdown(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) changed(update.state.doc.toString());
          }),
          attributes.of([]),
          THEME,
        ],
      }),
    });
    view.current = created;
    return () => {
      created.destroy();
      view.current = null;
    };
  }, [attributes, initial]);

  useEffect(() => {
    view.current?.dispatch({ effects: attributes.reconfigure(attributesOf(label, describedBy)) });
  }, [attributes, label, describedBy]);

  return <div ref={host} className="min-w-0" />;
}
