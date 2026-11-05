import { EditorView } from "@codemirror/view";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SourceBody } from "@/features/knowledge/editing/source-body.tsx";
import { VisualBody } from "@/features/knowledge/editing/visual-body.tsx";
import "@test/jsdom/layout.ts";

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

  it("points the field at the text that describes it", () => {
    render(
      <>
        <p id="hint">Write in plain words.</p>
        <VisualBody label="Body" value="Text" onChange={ignore} describedBy="hint" />
      </>,
    );

    expect(field().getAttribute("aria-describedby")).toBe("hint");
  });

  it("hands typed text back as markdown", async () => {
    const onChange = vi.fn<(markdown: string) => void>();
    render(<VisualBody label="Body" value="Start" onChange={onChange} />);

    caretAtEnd(field());
    await userEvent.setup().keyboard(" more");

    expect(onChange).toHaveBeenLastCalledWith("Start more");
  });

  it("turns a line into a list from the toolbar", async () => {
    const onChange = vi.fn<(markdown: string) => void>();
    const user = userEvent.setup();
    render(<VisualBody label="Body" value="Point one" onChange={onChange} />);

    const toolbar = screen.getByRole("toolbar", { name: "Formatting" });
    expect(toolbar.querySelectorAll("button")).toHaveLength(6);
    const list = screen.getByRole("button", { name: "Bulleted list" });
    expect(list.getAttribute("aria-pressed")).toBe("false");

    caretAtEnd(field());
    await user.click(list);

    expect(onChange).toHaveBeenLastCalledWith("- Point one");
    expect(list.getAttribute("aria-pressed")).toBe("true");
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

  it("points the field at the text that describes it", () => {
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
