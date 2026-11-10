import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

import { EDITOR_WORDS } from "@/features/knowledge/editing/editor-words.ts";

const NOTHING = () => undefined;

/** jsdom lacks scrollIntoView, which the list calls on the highlighted type as it opens. */
export const withATypePicker = (): void => {
  beforeEach(() => {
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      value: NOTHING,
      configurable: true,
      writable: true,
    });
  });
  afterEach(() => {
    Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  });
};

export const conceptTypeField = (): HTMLElement =>
  screen.getByRole("combobox", { name: EDITOR_WORDS.conceptType });

export const conceptTypeShown = (): string => conceptTypeField().textContent;

export const conceptTypeSearch = (): HTMLElement =>
  screen.getByRole("combobox", { name: EDITOR_WORDS.searchConceptTypes });

export const optionNames = async (): Promise<readonly string[]> =>
  (await screen.findAllByRole("option")).map((option) => option.textContent);

const openedTheTypes = (): void => {
  fireEvent.click(conceptTypeField());
};

export const choseAType = async (conceptType: string): Promise<void> => {
  openedTheTypes();
  fireEvent.click(await screen.findByRole("option", { name: conceptType }));
};

export const searchedTypesFor = async (typed: string): Promise<void> => {
  openedTheTypes();
  fireEvent.change(await screen.findByRole("combobox", { name: EDITOR_WORDS.searchConceptTypes }), {
    target: { value: typed },
  });
};

export const addedAType = async (conceptType: string): Promise<void> => {
  await searchedTypesFor(conceptType);
  fireEvent.click(
    await screen.findByRole("option", { name: EDITOR_WORDS.addConceptType(conceptType) }),
  );
};
