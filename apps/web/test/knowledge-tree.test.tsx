import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Opened } from "@/features/knowledge/knowledge-state.ts";
import { KnowledgeTree } from "@/features/knowledge/knowledge-tree.tsx";
import { KNOWLEDGE_BASE_WORDS as WORDS } from "@/features/knowledge/knowledge-words.ts";

afterEach(cleanup);

const COLLECTIONS = [
  {
    collection: "company",
    count: 4,
    kinds: [
      { kind: "insurance policy", count: 2 },
      { kind: "lease", count: 1 },
      { kind: "licence", count: 1 },
    ],
  },
  { collection: "product", count: 1, kinds: [{ kind: "datasheet", count: 1 }] },
  { collection: null, count: 1, kinds: [{ kind: "policy", count: 1 }] },
];

const TREE_WORDS = { name: WORDS.tree, collection: WORDS.collection, labelled: WORDS.labelled };

const drawn = (opened?: Opened) => {
  const onOpen = vi.fn<(collection: string | null, kind: string) => void>();
  render(
    <KnowledgeTree collections={COLLECTIONS} opened={opened} onOpen={onOpen} words={TREE_WORDS} />,
  );
  return onOpen;
};

const item = (name: string) => screen.getByRole("treeitem", { name: new RegExp(`^${name},`) });

const focused = () => document.activeElement;

const pressed = (key: string): boolean => fireEvent.keyDown(focused() ?? document.body, { key });

const fromCompany = () => {
  item("company").focus();
};

describe("the knowledge tree", () => {
  it("moves focus between tree items by arrow keys", () => {
    drawn();
    fromCompany();

    pressed("ArrowDown");
    expect(focused()).toBe(item("product"));
    pressed("ArrowDown");
    expect(focused()).toBe(item("No collection"));
    pressed("ArrowDown");
    expect(focused(), "Down past the last item moved on").toBe(item("No collection"));
    pressed("ArrowUp");
    expect(focused()).toBe(item("product"));
    expect(item("product").tabIndex).toBe(0);
    expect(item("company").tabIndex).toBe(-1);
  });

  it("opens a collection with the right arrow", () => {
    drawn();
    fromCompany();
    expect(item("company").getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("treeitem", { name: /^lease,/ })).toBeNull();

    pressed("ArrowRight");
    expect(item("company").getAttribute("aria-expanded")).toBe("true");
    expect(focused(), "the first Right moved focus").toBe(item("company"));
    pressed("ArrowRight");
    expect(focused()).toBe(item("insurance policy"));
    expect(item("insurance policy").getAttribute("aria-level")).toBe("2");
  });

  it("a typed letter moves to the next match", () => {
    drawn({ collection: "company", kind: "lease" });
    fromCompany();

    expect(pressed("l"), "the tree left a letter to the page").toBe(false);
    expect(focused()).toBe(item("lease"));
    pressed("L");
    expect(focused(), "the letter stayed on the match in focus").toBe(item("licence"));
    pressed("l");
    expect(focused()).toBe(item("lease"));
    pressed("P");
    expect(focused()).toBe(item("product"));
    pressed("i");
    expect(focused(), "the letter did not wrap to the top").toBe(item("insurance policy"));
    pressed("z");
    expect(focused()).toBe(item("insurance policy"));
  });

  it("leaves the question mark to the page's keystrokes", () => {
    drawn();
    fromCompany();

    expect(pressed("?")).toBe(true);
    expect(focused()).toBe(item("company"));
  });

  it("Home and End reach the first and last items", () => {
    drawn({ collection: null, kind: "policy" });
    item("policy").focus();

    pressed("Home");
    expect(focused()).toBe(item("company"));
    pressed("End");
    expect(focused()).toBe(item("policy"));
  });

  it("the left arrow climbs to a collection, then closes it", () => {
    drawn({ collection: "company", kind: "lease" });
    item("lease").focus();

    pressed("ArrowLeft");
    expect(focused()).toBe(item("company"));
    expect(item("company").getAttribute("aria-expanded")).toBe("true");
    pressed("ArrowLeft");
    expect(item("company").getAttribute("aria-expanded")).toBe("false");
  });

  it("Enter or a click on a kind opens it", () => {
    const onOpen = drawn({ collection: "company", kind: "lease" });
    expect(item("lease").getAttribute("aria-selected")).toBe("true");
    item("insurance policy").focus();

    pressed("Enter");
    expect(onOpen).toHaveBeenLastCalledWith("company", "insurance policy");
    fireEvent.click(item("product"));
    expect(onOpen, "a click on a collection opened a kind").toHaveBeenCalledTimes(1);
    fireEvent.click(item("datasheet"));
    expect(onOpen).toHaveBeenLastCalledWith("product", "datasheet");
    expect(focused()).toBe(item("datasheet"));
  });
});
