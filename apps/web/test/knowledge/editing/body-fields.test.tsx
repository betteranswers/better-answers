import { EditorView } from "@codemirror/view";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FORMATTING_WORDS } from "@/features/knowledge/editing/editor-words.ts";
import { SourceBody } from "@/features/knowledge/editing/source-body.tsx";
import { VisualBody } from "@/features/knowledge/editing/visual-body.tsx";
import "@test/jsdom/layout.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";

placedWithoutMeasuring();

afterEach(cleanup);

const ignore = (): void => {};

const field = () => screen.getByRole("textbox", { name: "Body" });

const caretAtEnd = (element: HTMLElement) => {
  element.focus();
  const selection = element.ownerDocument.getSelection();
  selection?.selectAllChildren(element.lastElementChild ?? element);
  selection?.collapseToEnd();
};

describe("the visual body field", () => {
  it("draws the starting markdown as formatted text", () => {
    render(
      <VisualBody label="Body" value={"## Retention\n\nWe keep **logs**."} onChange={ignore} />,
    );

    expect(field().getAttribute("aria-multiline")).toBe("true");
    expect(field().querySelector("h2")?.textContent).toBe("Retention");
    expect(field().querySelector("strong")?.textContent).toBe("logs");
  });

  it("links the field to its description", () => {
    render(
      <>
        <p id="hint">Write in plain words.</p>
        <VisualBody label="Body" value="Text" onChange={ignore} describedBy="hint" />
      </>,
    );

    expect(field().getAttribute("aria-describedby")).toBe("hint");
  });

  it("returns typed text as markdown", async () => {
    const onChange = vi.fn<(markdown: string) => void>();
    render(<VisualBody label="Body" value="Start" onChange={onChange} />);

    caretAtEnd(field());
    await userEvent.setup().keyboard(" more");

    expect(onChange).toHaveBeenLastCalledWith("Start more");
  });

  it("keeps the trailing newline the starting text had", async () => {
    const onChange = vi.fn<(markdown: string) => void>();
    render(<VisualBody label="Body" value={"Start\n"} onChange={onChange} />);

    caretAtEnd(field());
    await userEvent.setup().keyboard(" more");

    expect(onChange).toHaveBeenLastCalledWith("Start more\n");
  });

  it("adds no trailing newline to a body without one", async () => {
    const onChange = vi.fn<(markdown: string) => void>();
    render(<VisualBody label="Body" value="" onChange={onChange} />);

    caretAtEnd(field());
    await userEvent.setup().keyboard("First");

    expect(onChange).toHaveBeenLastCalledWith("First");
  });

  it("turns a line into a list from the toolbar", async () => {
    const onChange = vi.fn<(markdown: string) => void>();
    const user = userEvent.setup();
    render(<VisualBody label="Body" value="Point one" onChange={onChange} />);

    const list = screen.getByRole("button", { name: FORMATTING_WORDS.bulletedList });
    expect(list.getAttribute("aria-pressed")).toBe("false");

    caretAtEnd(field());
    await user.click(list);

    expect(onChange).toHaveBeenLastCalledWith("- Point one");
    expect(list.getAttribute("aria-pressed")).toBe("true");
  });

  it("names each toolbar button and tips it the same", async () => {
    const user = userEvent.setup();
    render(<VisualBody label="Body" value="Text" onChange={ignore} />);

    const toolbar = screen.getByRole("toolbar", { name: FORMATTING_WORDS.toolbar });
    const { toolbar: _own, ...buttons } = FORMATTING_WORDS;
    const names = Object.values(buttons);
    expect(
      within(toolbar)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(names);

    for (const name of names) {
      await user.hover(within(toolbar).getByRole("button", { name }));
      expect((await screen.findByRole("tooltip")).textContent).toBe(name);
      await user.keyboard("{Escape}");
      await waitFor(() => {
        expect(screen.queryByRole("tooltip")).toBeNull();
      });
    }
  });

  it("takes one tab stop and arrows across the toolbar", async () => {
    const user = userEvent.setup();
    render(<VisualBody label="Body" value="Text" onChange={ignore} />);
    const toolbar = within(screen.getByRole("toolbar", { name: FORMATTING_WORDS.toolbar }));
    const [first, second] = toolbar.getAllByRole("button");

    await user.tab();
    expect(document.activeElement).toBe(first);
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(second);
    await user.tab();

    expect(toolbar.getAllByRole("button")).not.toContain(document.activeElement);
  });

  it("draws a footnote reference as a mark and keeps it", async () => {
    const onChange = vi.fn<(markdown: string) => void>();
    render(<VisualBody label="Body" value="We keep logs.[^source-1]" onChange={onChange} />);

    expect(field().querySelector("sup")?.textContent).toBe("source-1");

    caretAtEnd(field());
    await userEvent.setup().keyboard(" More.");
    expect(onChange).toHaveBeenLastCalledWith("We keep logs.[^source-1] More.");
  });
});

describe("the source body field", () => {
  it("shows the starting markdown as written", () => {
    render(<SourceBody label="Body" value={"## Retention\n\n_logs_"} onChange={ignore} />);

    expect(field().getAttribute("aria-multiline")).toBe("true");
    expect(field().textContent).toBe("## Retention_logs_");
  });

  it("links the field to its description", () => {
    render(
      <>
        <p id="hint">Write in plain words.</p>
        <SourceBody label="Body" value="Text" onChange={ignore} describedBy="hint" />
      </>,
    );

    expect(field().getAttribute("aria-describedby")).toBe("hint");
  });

  it("reports an edit but not a caret move", () => {
    const onChange = vi.fn<(markdown: string) => void>();
    render(<SourceBody label="Body" value="Start" onChange={onChange} />);
    const view = EditorView.findFromDOM(field());

    view?.dispatch({ selection: { anchor: 5 } });
    expect(onChange).not.toHaveBeenCalled();

    view?.dispatch({ changes: { from: 5, insert: " more" } });
    expect(onChange).toHaveBeenCalledExactlyOnceWith("Start more");
  });

  it("keeps its text when the parent passes a new value", () => {
    const { rerender } = render(<SourceBody label="Body" value="First" onChange={ignore} />);
    const view = EditorView.findFromDOM(field());
    view?.dispatch({ changes: { from: 5, insert: " typed" } });

    rerender(<SourceBody label="Body" value="Second" onChange={ignore} />);

    expect(view?.state.doc.toString()).toBe("First typed");
  });
});
