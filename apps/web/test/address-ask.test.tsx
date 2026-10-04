import { act, cleanup, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { askingHere, useAsked } from "@/shared/address-ask.ts";

import { openPages } from "./address-router.tsx";

afterEach(cleanup);

/** Keeps each search in its own state, the one place `take` may write during render. */
const Members = () => {
  const [taken, setTaken] = useState<readonly string[]>([]);
  useAsked("search", (value) => setTaken((before) => [...before, value]));
  return <output>{taken.join(" ")}</output>;
};

const takenSoFar = () => screen.getByRole("status").textContent;

const openAt = (...entries: readonly string[]) =>
  openPages({ "/members": Members, "/elsewhere": () => null }, entries);

describe("a search another place asks of a page", () => {
  it("is taken once, then cleared from the address in place", async () => {
    const { history, at } = await openAt("/elsewhere", "/members?search=priya");

    await at("/members");
    expect(takenSoFar()).toBe("priya");
    expect(history.length, "the clear pushed an entry of its own").toBe(2);
  });

  it("is never asked again by a step back and forward", async () => {
    const { history, at } = await openAt("/elsewhere", "/members?search=priya");
    await at("/members");

    act(() => history.back());
    await at("/elsewhere");
    act(() => history.forward());
    await at("/members");

    expect(takenSoFar(), "the page took an ask on its way back").toBe("");
  });

  it("is taken by a page already open", async () => {
    const { router, at } = await openAt("/members?search=priya");
    await at("/members");

    await act(() => router.navigate({ href: "/members?search=tom" }));
    await at("/members");

    expect(takenSoFar()).toBe("priya tom");
  });

  it("clears its own key and leaves a list's in place", async () => {
    const { history, at } = await openAt("/elsewhere", "/members?members.role=Editor&search=priya");

    await at("/members?members.role=Editor");
    expect(takenSoFar()).toBe("priya");
    expect(history.length, "the clear pushed an entry of its own").toBe(2);
  });
});

const ActAndSearch = () => {
  const [taken, setTaken] = useState<readonly string[]>([]);
  useAsked("act", (value) => setTaken((before) => [...before, `act ${value}`]));
  useAsked("search", (value) => setTaken((before) => [...before, `search ${value}`]));
  return <output>{taken.join(", ")}</output>;
};

describe("two asks in one address", () => {
  it("takes each once and clears both from the address", async () => {
    const { history, at } = await openPages(
      { "/members": ActAndSearch, "/elsewhere": () => null },
      ["/elsewhere", "/members?act=invite&search=priya"],
    );

    await at("/members");
    expect(takenSoFar()).toBe("act invite, search priya");
    expect(history.length, "a clear pushed an entry of its own").toBe(2);
  });
});

describe("asking a page for an act", () => {
  const HERE = { pathname: "/members", searchStr: "?members.role=Editor&members.page=2" };

  it("adds to the query of the page already open", () => {
    expect(askingHere(HERE, "/members", "act", "invite")).toBe(
      "/members?members.role=Editor&members.page=2&act=invite",
    );
  });

  it("carries no other page's query", () => {
    expect(askingHere(HERE, "/groups", "act", "invite")).toBe("/groups?act=invite");
    const onGroups = { pathname: "/groups", searchStr: "?groups.search=ops" };
    expect(askingHere(onGroups, "/members", "act", "invite")).toBe("/members?act=invite");
  });
});
