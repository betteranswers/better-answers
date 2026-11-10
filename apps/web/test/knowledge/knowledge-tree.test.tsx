import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { collectionNameOf } from "@better-answers/schema/collection-name";

import type { OpenConceptType } from "@/features/knowledge/knowledge-state.ts";
import { initiallyExpanded, KnowledgeTree, toggled } from "@/features/knowledge/knowledge-tree.tsx";

afterEach(cleanup);

const COLLECTIONS = [
  {
    collection: "company",
    count: 4,
    conceptTypes: [
      { conceptType: "insurance policy", count: 2 },
      { conceptType: "lease", count: 1 },
      { conceptType: "licence", count: 1 },
    ],
  },
  { collection: "product", count: 1, conceptTypes: [{ conceptType: "datasheet", count: 1 }] },
  { collection: null, count: 1, conceptTypes: [{ conceptType: "policy", count: 1 }] },
];

type Opened = (collection: string | null, conceptType: string) => void;

function Tree(properties: { readonly open: OpenConceptType; readonly onOpen: Opened }) {
  const [expanded, setExpanded] = useState(() => initiallyExpanded(properties.open));
  return (
    <KnowledgeTree
      collections={COLLECTIONS}
      open={properties.open}
      onOpen={properties.onOpen}
      expanded={expanded}
      onToggle={(collection) => {
        setExpanded((held) => toggled(held, collection));
      }}
    />
  );
}

const drawn = (open?: OpenConceptType) => {
  const onOpen = vi.fn<Opened>();
  render(<Tree open={open} onOpen={onOpen} />);
  return onOpen;
};

const item = (name: string) => screen.getByRole("treeitem", { name: new RegExp(`^${name},`) });

const collectionItem = (collection: string) => item(collectionNameOf(collection));

const focused = () => document.activeElement;

const pressed = (key: string): boolean => fireEvent.keyDown(focused() ?? document.body, { key });

const fromCompany = () => {
  collectionItem("company").focus();
};

describe("the knowledge tree", () => {
  it("moves focus between tree items by arrow keys", () => {
    drawn();
    fromCompany();

    pressed("ArrowDown");
    expect(focused()).toBe(collectionItem("product"));
    pressed("ArrowDown");
    expect(focused()).toBe(item("No collection"));
    pressed("ArrowDown");
    expect(focused(), "Down moved focus past the last item").toBe(item("No collection"));
    pressed("ArrowUp");
    expect(focused()).toBe(collectionItem("product"));
    expect(collectionItem("product").tabIndex).toBe(0);
    expect(collectionItem("company").tabIndex).toBe(-1);
  });

  it("opens a collection with the right arrow", () => {
    drawn();
    fromCompany();
    expect(collectionItem("company").getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("treeitem", { name: /^lease,/ })).toBeNull();

    pressed("ArrowRight");
    expect(collectionItem("company").getAttribute("aria-expanded")).toBe("true");
    expect(focused(), "the first Right moved focus instead of opening").toBe(
      collectionItem("company"),
    );
    pressed("ArrowRight");
    expect(focused()).toBe(item("insurance policy"));
    expect(item("insurance policy").getAttribute("aria-level")).toBe("2");
  });

  it("moves to the next item starting with a typed letter", () => {
    drawn({ collection: "company", conceptType: "lease" });
    fromCompany();

    expect(pressed("l"), "the tree let the typed letter reach the page").toBe(false);
    expect(focused()).toBe(item("lease"));
    pressed("L");
    expect(focused(), "the letter did not move past the match in focus").toBe(item("licence"));
    pressed("l");
    expect(focused()).toBe(item("lease"));
    pressed("P");
    expect(focused()).toBe(collectionItem("product"));
    pressed("i");
    expect(focused(), "the letter did not wrap to the top").toBe(item("insurance policy"));
    pressed("z");
    expect(focused()).toBe(item("insurance policy"));
  });

  it("leaves the question mark to the page's keystrokes", () => {
    drawn();
    fromCompany();

    expect(pressed("?")).toBe(true);
    expect(focused()).toBe(collectionItem("company"));
  });

  it("reaches the first item by Home, the last by End", () => {
    drawn({ collection: null, conceptType: "policy" });
    item("policy").focus();

    pressed("Home");
    expect(focused()).toBe(collectionItem("company"));
    pressed("End");
    expect(focused()).toBe(item("policy"));
  });

  it("moves up to a collection with Left, then closes it", () => {
    drawn({ collection: "company", conceptType: "lease" });
    item("lease").focus();

    pressed("ArrowLeft");
    expect(focused()).toBe(collectionItem("company"));
    expect(collectionItem("company").getAttribute("aria-expanded")).toBe("true");
    pressed("ArrowLeft");
    expect(collectionItem("company").getAttribute("aria-expanded")).toBe("false");
  });

  it("opens a type with Enter or a click", () => {
    const onOpen = drawn({ collection: "company", conceptType: "lease" });
    expect(item("lease").getAttribute("aria-selected")).toBe("true");
    item("insurance policy").focus();

    pressed("Enter");
    expect(onOpen).toHaveBeenLastCalledWith("company", "insurance policy");
    fireEvent.click(collectionItem("product"));
    expect(onOpen, "a click on a collection opened a type").toHaveBeenCalledTimes(1);
    fireEvent.click(item("datasheet"));
    expect(onOpen).toHaveBeenLastCalledWith("product", "datasheet");
    expect(focused()).toBe(item("datasheet"));
  });
});
