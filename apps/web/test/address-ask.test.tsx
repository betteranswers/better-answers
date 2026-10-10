import { act, cleanup, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { askedIn, askingHere, useAsked } from "@/shared/address-ask.ts";

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

describe("a search that reads as JSON", () => {
  it.each(["1e3", "1.50", "true", "null", '"audit logs"', '{"a": 1}', "[1, 2]", '"1e3"', " 7 "])(
    "is taken as typed: %s",
    async (typed) => {
      const { router, at } = await openAt("/elsewhere");

      await act(() =>
        router.navigate({
          href: askingHere({ pathname: "/elsewhere", searchStr: "" }, "/members", "search", typed),
        }),
      );
      await at("/members");

      expect(takenSoFar()).toBe(typed);
    },
  );
});

const ActionAndSearch = () => {
  const [taken, setTaken] = useState<readonly string[]>([]);
  useAsked("action", (value) => setTaken((before) => [...before, `action ${value}`]));
  useAsked("search", (value) => setTaken((before) => [...before, `search ${value}`]));
  return <output>{taken.join(", ")}</output>;
};

const openActionAndSearchAt = (asked: string) =>
  openPages({ "/members": ActionAndSearch, "/elsewhere": () => null }, ["/elsewhere", asked]);

describe("an ask as the address holds it", () => {
  it("asks a JSON-looking value as its JSON string", () => {
    const here = { pathname: "/elsewhere", searchStr: "" };

    expect(askingHere(here, "/members", "search", "1.50")).toBe("/members?search=%221.50%22");
    expect(askingHere(here, "/members", "search", "audit logs")).toBe("/members?search=audit+logs");
  });

  it("is read as typed from either form", () => {
    expect(askedIn(new URLSearchParams("?search=%221.50%22"), "search")).toBe("1.50");
    expect(askedIn(new URLSearchParams("?search=1.50"), "search")).toBe("1.50");
    expect(askedIn(new URLSearchParams("?search=audit+logs"), "search")).toBe("audit logs");
  });
});

describe("two asks in one address", () => {
  it("takes each once and clears both from the address", async () => {
    const { history, at } = await openActionAndSearchAt("/members?action=invite&search=priya");

    await at("/members");
    expect(takenSoFar()).toBe("action invite, search priya");
    expect(history.length, "a clear pushed an entry of its own").toBe(2);
  });

  it("takes an action under its older key, then clears it", async () => {
    const { history, at } = await openActionAndSearchAt("/members?act=invite&search=priya");

    await at("/members");
    expect(takenSoFar()).toBe("action invite, search priya");
    expect(history.length, "a clear pushed an entry of its own").toBe(2);
  });
});

describe("asking a page for an action", () => {
  const HERE = { pathname: "/members", searchStr: "?members.role=Editor&members.page=2" };

  it("adds to the query of the page already open", () => {
    expect(askingHere(HERE, "/members", "action", "invite")).toBe(
      "/members?members.role=Editor&members.page=2&action=invite",
    );
  });

  it("carries no other page's query", () => {
    expect(askingHere(HERE, "/groups", "action", "invite")).toBe("/groups?action=invite");
    const onGroups = { pathname: "/groups", searchStr: "?groups.search=ops" };
    expect(askingHere(onGroups, "/members", "action", "invite")).toBe("/members?action=invite");
  });

  it("reads a return address's action under its older key", () => {
    const signedInAgain = new URLSearchParams("?search=priya%40acme.invalid&person=p1&act=correct");

    expect(askedIn(signedInAgain, "action")).toBe("correct");
  });
});
