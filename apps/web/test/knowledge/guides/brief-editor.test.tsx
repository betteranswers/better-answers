import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BriefBody } from "@/features/knowledge/guides/brief-body.tsx";
import { SEARCH_PAGE } from "@/shared/knowledge/concept-address.ts";
import { asksOf } from "@test/knowledge/concept-editing-answers.ts";
import {
  A_GUIDE_PAGE,
  A_WRITE_UP_ID,
  aBrief,
  aGuide,
  aGuideApi,
  aSection,
  AN_INCLUDE_ID,
  BRIEF_BEFORE,
  BRIEF_MARKED,
  RACKING_IRI,
  RACKING_TITLE,
  SAVE_BRIEF,
} from "@test/knowledge/guide-answers.ts";
import "@test/jsdom/layout.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { heldBack } from "@test/stubbed-api.ts";
import { ADA, aRefusalAnswer, openAt, read } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

await import("@/features/knowledge/guides/brief-editor.tsx");

placedWithoutMeasuring();

beforeEach(() => {
  sessionStorage.clear();
});

const LABEL = "Brief of section 1";

const INCLUDES = [{ label: AN_INCLUDE_ID, iri: RACKING_IRI, title: RACKING_TITLE }];

const textField = () => screen.getByRole("textbox", { name: LABEL });

const caretAtEnd = (element: HTMLElement) => {
  element.focus();
  const selection = element.ownerDocument.getSelection();
  selection?.selectAllChildren(element.lastElementChild ?? element);
  selection?.collapseToEnd();
};

const status = () => within(screen.getByRole("article")).getByRole("status");

const opened = async (api = aGuideApi("Editor")) => {
  const router = await openAt(A_GUIDE_PAGE, api);
  fireEvent.click(await screen.findByRole("button", { name: "Edit Brief" }));
  await screen.findByRole("textbox", { name: LABEL });
  return { api, router };
};

const typedAtTheEnd = async (words: string) => {
  caretAtEnd(textField());
  await userEvent.setup().keyboard(words);
};

const saveBrief = () => {
  fireEvent.click(screen.getByRole("button", { name: "Save Brief" }));
};

const savedAt = (version: number) => () => read({ saved: true, version });

const savedAndClosed = async () => {
  const { api, router } = await opened();
  api.set(SAVE_BRIEF, savedAt(3));
  await typedAtTheEnd(" more");
  saveBrief();
  await waitFor(() => {
    expect(screen.queryByRole("textbox", { name: LABEL })).toBeNull();
  });
  return router;
};

describe("moving among a Brief's footnote chips", () => {
  const draw = (onChange = vi.fn<(markdown: string) => void>()) => {
    render(
      <BriefBody
        label={LABEL}
        value={`Pallets[^${AN_INCLUDE_ID}] are racked.`}
        includes={INCLUDES}
        placed={new Set([AN_INCLUDE_ID])}
        onChange={onChange}
      />,
    );
    return onChange;
  };

  const caretIn = async (text: string, at: number) => {
    const field = textField();
    await waitFor(() => {
      expect(document.activeElement).toBe(field);
    });
    const node = [...field.querySelectorAll("p")]
      .flatMap((each) => [...each.childNodes])
      .find((each) => each.nodeType === Node.TEXT_NODE && each.textContent === text);
    if (node === undefined) throw new Error(`no text ${text} in the editor`);
    field.ownerDocument.getSelection()?.collapse(node, at);
  };

  it("draws a chip named by the concept's title", () => {
    draw();

    const chip = textField().querySelector("[data-footnote-reference]");
    expect(chip?.getAttribute("data-footnote-reference")).toBe(AN_INCLUDE_ID);
    expect(chip?.textContent).toBe(`Footnote: ${RACKING_TITLE}`);
  });

  it("moves past a footnote chip with one arrow key", async () => {
    const onChange = draw();

    await caretIn("Pallets", "Pallets".length);
    await userEvent.setup().keyboard("{ArrowRight}X");

    expect(onChange).toHaveBeenLastCalledWith(`Pallets[^${AN_INCLUDE_ID}]X are racked.`);
  });

  it("moves back past a chip with one arrow key", async () => {
    const onChange = draw();

    await caretIn(" are racked.", 0);
    await userEvent.setup().keyboard("{ArrowLeft}Y");

    expect(onChange).toHaveBeenLastCalledWith(`PalletsY[^${AN_INCLUDE_ID}] are racked.`);
  });

  it("never lets typing enter a chip", async () => {
    const onChange = draw();

    await caretIn("Pallets", "Pallets".length);
    await userEvent.setup().keyboard("{ArrowRight}Z");

    expect(textField().querySelector("[data-footnote-reference]")?.textContent).toBe(
      `Footnote: ${RACKING_TITLE}`,
    );
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("places a footnote at the caret and marks it placed", async () => {
    const onChange = vi.fn<(markdown: string) => void>();
    const { rerender } = render(
      <BriefBody
        label={LABEL}
        value="Pallets are racked."
        includes={INCLUDES}
        placed={new Set()}
        onChange={onChange}
      />,
    );
    const place = screen.getByRole("button", { name: `${RACKING_TITLE} (not placed)` });

    caretAtEnd(textField());
    fireEvent.click(place);

    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith(`Pallets are racked.[^${AN_INCLUDE_ID}]`);
    });
    rerender(
      <BriefBody
        label={LABEL}
        value="Pallets are racked."
        includes={INCLUDES}
        placed={new Set([AN_INCLUDE_ID])}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole("button", { name: RACKING_TITLE })).toBeDefined();
  });

  it("says when a section includes nothing to place", () => {
    render(
      <BriefBody
        label={LABEL}
        value="Pallets are racked."
        includes={[]}
        placed={new Set()}
        onChange={vi.fn<(markdown: string) => void>()}
      />,
    );

    expect(screen.getByText(/No concepts are included in this section/u)).toBeDefined();
  });
});

describe("saving a Brief", () => {
  it("announces an unchanged save in the status region", async () => {
    const { api } = await opened();
    api.set(SAVE_BRIEF, () => read({ saved: false, version: 2 }));

    saveBrief();

    await waitFor(() => {
      expect(status().textContent).toBe("No changes to save. Version 2 stands.");
    });
    expect(asksOf(SAVE_BRIEF)).toEqual([
      { writeUpId: A_WRITE_UP_ID, markdown: BRIEF_MARKED, base: 2 },
    ]);
    expect(textField()).toBeDefined();
  });

  it("says Saving the Brief at once, then the version", async () => {
    const { api } = await opened();
    const held = heldBack(api, SAVE_BRIEF, read({ saved: true, version: 3 }));
    await typedAtTheEnd(" more");

    saveBrief();

    await held.asked;
    expect(status().textContent).toBe("Saving the Brief.");
    held.resolve();
    await waitFor(() => {
      expect(status().textContent).toBe("Saved version 3.");
    });
  });

  it("sends the edited Brief against the version it opened with", async () => {
    const { api } = await opened();
    api.set(SAVE_BRIEF, savedAt(3));
    await typedAtTheEnd(" more");

    saveBrief();

    await waitFor(() => {
      expect(asksOf(SAVE_BRIEF)).toEqual([
        { writeUpId: A_WRITE_UP_ID, markdown: `${BRIEF_MARKED} more`, base: 2 },
      ]);
    });
  });

  it("closes after a save and refocuses Edit Brief", async () => {
    await savedAndClosed();

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit Brief" }));
  });

  it("saves on the keystroke from inside the text", async () => {
    const { api } = await opened();
    api.set(SAVE_BRIEF, savedAt(3));

    fireEvent.keyDown(textField(), { key: "Enter", ctrlKey: true });

    await waitFor(() => {
      expect(status().textContent).toBe("Saved version 3.");
    });
  });

  it("locks the text while the save is waiting", async () => {
    const { api } = await opened();
    const held = heldBack(api, SAVE_BRIEF, read({ saved: true, version: 3 }));

    saveBrief();
    await held.asked;

    expect(screen.getByRole("button", { name: "Save Brief" }).getAttribute("aria-disabled")).toBe(
      "true",
    );
    expect(textField().closest("[inert]")).not.toBeNull();
    held.resolve();
    await waitFor(() => {
      expect(screen.queryByRole("textbox", { name: LABEL })).toBeNull();
    });
  });

  it("leaves the text with Escape to reach Save Brief", async () => {
    await opened();

    caretAtEnd(textField());
    fireEvent.keyDown(textField(), { key: "Escape" });

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Save Brief" }));
  });
});

describe("a Brief saved after you opened it", () => {
  const later = aGuide({
    sections: [
      aSection({
        brief: aBrief({
          version: 3,
          editable: { markdown: `Someone else's words[^${AN_INCLUDE_ID}]`, footnotes: INCLUDES },
        }),
      }),
    ],
  });

  const refused = async () => {
    const { api } = await opened();
    api.set(SAVE_BRIEF, () => {
      api.set("knowledge.guide", () => read(later));
      return aRefusalAnswer("stale-precondition", "conflict", 409);
    });
    await typedAtTheEnd(" my words");
    saveBrief();
    await waitFor(() => {
      expect(status().textContent).toBe("Someone saved this Brief after you opened it.");
    });
    return api;
  };

  it("says so and keeps the draft", async () => {
    await refused();

    expect(textField().textContent).toContain("my words");
    expect(screen.queryByRole("button", { name: "Save Brief" })).toBeNull();
    expect(screen.getByRole("button", { name: "Reload the Brief" })).toBeDefined();
  });

  it("reloads onto the latest version on request", async () => {
    const api = await refused();
    api.set(SAVE_BRIEF, savedAt(4));

    fireEvent.click(screen.getByRole("button", { name: "Reload the Brief" }));

    await waitFor(() => {
      expect(textField().textContent).toContain("Someone else's words");
    });
    expect(textField().textContent).not.toContain("my words");
    saveBrief();
    await waitFor(() => {
      expect(asksOf(SAVE_BRIEF).at(-1)).toEqual({
        writeUpId: A_WRITE_UP_ID,
        markdown: `Someone else's words[^${AN_INCLUDE_ID}]`,
        base: 3,
      });
    });
  });
});

describe("a Brief refused for another reason", () => {
  it("says why and keeps the draft editable", async () => {
    const { api } = await opened();
    api.set(SAVE_BRIEF, () => aRefusalAnswer("marker-without-include", "inapplicable", 422));
    await typedAtTheEnd(" more");

    saveBrief();

    const said = await screen.findByText(/no longer includes/u);
    expect(said.closest('[role="alert"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "Save Brief" }).getAttribute("aria-disabled")).toBe(
      "false",
    );
    expect(textField().closest("[inert]")).toBeNull();
    expect(textField().textContent).toContain("more");
  });
});

describe("a draft of a Brief", () => {
  const draftKey = `better-answers.brief-draft.${ADA.personId}.${A_WRITE_UP_ID}.2`;

  it("survives a reload of the page", async () => {
    await opened();
    await typedAtTheEnd(" more");
    await waitFor(() => {
      expect(sessionStorage.getItem(draftKey)).toContain("more");
    });

    cleanup();
    await opened();

    expect(textField().textContent).toContain("more");
  });

  it("survives closing the editor", async () => {
    await opened();
    await typedAtTheEnd(" more");

    fireEvent.click(screen.getByRole("button", { name: "Close editor" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit Brief" }));

    await waitFor(() => {
      expect(textField().textContent).toContain("more");
    });
  });

  it("is forgotten once it is saved", async () => {
    const { api } = await opened();
    api.set(SAVE_BRIEF, savedAt(3));
    await typedAtTheEnd(" more");
    await waitFor(() => {
      expect(sessionStorage.getItem(draftKey)).not.toBeNull();
    });

    saveBrief();

    await waitFor(() => {
      expect(sessionStorage.getItem(draftKey)).toBeNull();
    });
  });

  it("is not kept when nothing changed", async () => {
    await opened();

    await waitFor(() => {
      expect(textField()).toBeDefined();
    });
    expect(sessionStorage.getItem(draftKey)).toBeNull();
  });

  it("does not carry over to another version", async () => {
    await opened();
    await typedAtTheEnd(" more");
    await waitFor(() => {
      expect(sessionStorage.getItem(draftKey)).not.toBeNull();
    });
    cleanup();

    const newer = aGuide({ sections: [aSection({ brief: aBrief({ version: 3 }) })] });
    await opened(aGuideApi("Editor", newer));

    expect(textField().textContent).not.toContain("more");
  });
});

describe("leaving with an unsaved draft", () => {
  const ASK = "You have changes to a Brief that are not saved.";

  const addAFact = () => {
    fireEvent.click(screen.getByRole("link", { name: "Add This Fact" }));
  };

  const askedToLeave = () => screen.findByRole("alertdialog", { name: ASK });

  const onSearch = (router: Awaited<ReturnType<typeof opened>>["router"]): boolean =>
    router.state.location.pathname === SEARCH_PAGE.path;

  it("asks once and stays when told to keep editing", async () => {
    const { router } = await opened();
    await typedAtTheEnd(" more");

    addAFact();

    const ask = await askedToLeave();
    expect(router.state.location.pathname).toBe(A_GUIDE_PAGE);
    expect(document.activeElement).toBe(within(ask).getByRole("button", { name: "Keep editing" }));

    fireEvent.click(within(ask).getByRole("button", { name: "Keep editing" }));

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
    expect(router.state.location.pathname).toBe(A_GUIDE_PAGE);
    expect(textField().textContent).toContain("more");
  });

  it("asks again at the next attempt to leave", async () => {
    const { router } = await opened();
    await typedAtTheEnd(" more");
    addAFact();
    fireEvent.click(within(await askedToLeave()).getByRole("button", { name: "Keep editing" }));
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });

    addAFact();

    expect(await askedToLeave()).toBeDefined();
    expect(router.state.location.pathname).toBe(A_GUIDE_PAGE);
  });

  it("leaves when told to leave", async () => {
    const { router } = await opened();
    await typedAtTheEnd(" more");

    addAFact();
    fireEvent.click(within(await askedToLeave()).getByRole("button", { name: "Leave" }));

    await waitFor(() => {
      expect(onSearch(router)).toBe(true);
    });
  });

  it("asks nothing when the draft is unchanged", async () => {
    const { router } = await opened();

    addAFact();

    await waitFor(() => {
      expect(onSearch(router)).toBe(true);
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("asks nothing once the editor is saved and closed", async () => {
    const router = await savedAndClosed();

    addAFact();

    await waitFor(() => {
      expect(onSearch(router)).toBe(true);
    });
  });
});

describe("opening the editor", () => {
  it("opens with the stored text and the chip's title", async () => {
    await opened();

    expect(textField().textContent).toContain("Pallets are racked");
    expect(textField().textContent).toContain(RACKING_TITLE);
    expect(textField().textContent).not.toContain(AN_INCLUDE_ID);
    expect(BRIEF_BEFORE).toBe("Pallets are racked by row.");
  });

  it("returns to the open text on e", async () => {
    await opened();
    const show = screen.getByRole("button", { name: "Show Detail" });

    show.focus();
    fireEvent.keyDown(show, { key: "e" });

    await waitFor(() => {
      expect(document.activeElement).toBe(textField());
    });
  });

  it("opens on e for the section in focus", async () => {
    await openAt(A_GUIDE_PAGE, aGuideApi("Editor"));
    const show = await screen.findByRole("button", { name: "Show Detail" });

    show.focus();
    fireEvent.keyDown(show, { key: "e" });

    expect(await screen.findByRole("textbox", { name: LABEL })).toBeDefined();
  });

  it("offers a Viewer no editor on e", async () => {
    await openAt(
      A_GUIDE_PAGE,
      aGuideApi("Viewer", aGuide({ sections: [aSection({ brief: undefined })] })),
    );
    await screen.findByRole("article");

    fireEvent.keyDown(document.body, { key: "e" });

    expect(screen.queryByRole("textbox", { name: LABEL })).toBeNull();
    expect(status().textContent).toBe("");
  });
});
