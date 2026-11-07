import { act, cleanup, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { askedIn, askingHere, useAsked } from "@/shared/address/address-ask.ts";
import { openPages } from "@test/address-router.tsx";

afterEach(cleanup);

/** Records each received search in state; the callback may set state during render. */
const Members = () => {
  const [received, setReceived] = useState<readonly string[]>([]);
  useAsked("search", (value) => setReceived((before) => [...before, value]));
  return <output>{received.join(" ")}</output>;
};

const receivedSoFar = () => screen.getByRole("status").textContent;

const openAt = (...entries: readonly string[]) =>
  openPages({ "/members": Members, "/elsewhere": () => null }, entries);

describe("a search passed to a page in the URL", () => {
  it("is received once, then removed from the URL", async () => {
    const { history, at } = await openAt("/elsewhere", "/members?search=priya");

    await at("/members");
    expect(receivedSoFar()).toBe("priya");
    expect(history.length, "removing the search added a history entry").toBe(2);
  });

  it("is not received again after going back and forward", async () => {
    const { history, at } = await openAt("/elsewhere", "/members?search=priya");
    await at("/members");

    act(() => history.back());
    await at("/elsewhere");
    act(() => history.forward());
    await at("/members");

    expect(receivedSoFar(), "the page received the search again after back and forward").toBe("");
  });

  it("is received by a page that is already open", async () => {
    const { router, at } = await openAt("/members?search=priya");
    await at("/members");

    await act(() => router.navigate({ href: "/members?search=tom" }));
    await at("/members");

    expect(receivedSoFar()).toBe("priya tom");
  });

  it("removes only its own key, keeping list keys", async () => {
    const { history, at } = await openAt("/elsewhere", "/members?members.role=Editor&search=priya");

    await at("/members?members.role=Editor");
    expect(receivedSoFar()).toBe("priya");
    expect(history.length, "removing the search added a history entry").toBe(2);
  });
});

describe("a search that looks like JSON", () => {
  it.each(["1e3", "1.50", "true", "null", '"audit logs"', '{"a": 1}', "[1, 2]", '"1e3"', " 7 "])(
    "is received as typed: %s",
    async (typed) => {
      const { router, at } = await openAt("/elsewhere");

      await act(() =>
        router.navigate({
          href: askingHere({ pathname: "/elsewhere", searchStr: "" }, "/members", "search", typed),
        }),
      );
      await at("/members");

      expect(receivedSoFar()).toBe(typed);
    },
  );
});

const ActionAndSearch = () => {
  const [received, setReceived] = useState<readonly string[]>([]);
  useAsked("action", (value) => setReceived((before) => [...before, `action ${value}`]));
  useAsked("search", (value) => setReceived((before) => [...before, `search ${value}`]));
  return <output>{received.join(", ")}</output>;
};

const openActionAndSearchAt = (address: string) =>
  openPages({ "/members": ActionAndSearch, "/elsewhere": () => null }, ["/elsewhere", address]);

describe("encoding a URL parameter", () => {
  const here = { pathname: "/elsewhere", searchStr: "" };

  const JSON_ENCODED = [
    ["1.50", "%221.50%22"],
    ["1e3", "%221e3%22"],
    ['"audit logs"', "%22%5C%22audit+logs%5C%22%22"],
  ] as const;

  it.each(JSON_ENCODED)("encodes %s as a JSON string", (typed, encoded) => {
    expect(askingHere(here, "/members", "search", typed)).toBe(`/members?search=${encoded}`);
  });

  it.each(JSON_ENCODED)("decodes %s from its JSON string", (typed, encoded) => {
    expect(askedIn(new URLSearchParams(`?search=${encoded}`), "search")).toBe(typed);
  });

  it("leaves plain words unquoted", () => {
    expect(askingHere(here, "/members", "search", "audit logs")).toBe("/members?search=audit+logs");
    expect(askingHere(here, "/members", "action", "invite")).toBe("/members?action=invite");
  });

  it("carries a question to another page and reads it back", () => {
    const to = askingHere(here, "/ask/new-question", "question", "Can we bill in euros?");

    expect(to).toBe("/ask/new-question?question=Can+we+bill+in+euros%3F");
    expect(askedIn(new URLSearchParams(to.split("?")[1]), "question")).toBe(
      "Can we bill in euros?",
    );
  });

  it("decodes an unquoted value as written", () => {
    expect(askedIn(new URLSearchParams("?search=1.5"), "search")).toBe("1.5");
    expect(askedIn(new URLSearchParams("?search=audit+logs"), "search")).toBe("audit logs");
    expect(askedIn(new URLSearchParams("?action=invite"), "action")).toBe("invite");
  });
});

describe("a search typed into the URL by hand", () => {
  it.each(["audit", "1.5", "1.50", "1e3"])("is received as written: %s", async (written) => {
    const { at } = await openAt("/elsewhere", `/members?search=${written}`);

    await at("/members");
    expect(receivedSoFar()).toBe(written);
  });
});

describe("two parameters in one URL", () => {
  it("receives each once and removes both from the URL", async () => {
    const { history, at } = await openActionAndSearchAt("/members?action=invite&search=priya");

    await at("/members");
    expect(receivedSoFar()).toBe("action invite, search priya");
    expect(history.length, "removing the parameters added a history entry").toBe(2);
  });

  it("receives an action under its legacy key, then removes it", async () => {
    const { history, at } = await openActionAndSearchAt("/members?act=invite&search=priya");

    await at("/members");
    expect(receivedSoFar()).toBe("action invite, search priya");
    expect(history.length, "removing the parameters added a history entry").toBe(2);
  });
});

describe("building a URL that requests an action", () => {
  const HERE = { pathname: "/members", searchStr: "?members.role=Editor&members.page=2" };

  it("keeps the current page's query on the same page", () => {
    expect(askingHere(HERE, "/members", "action", "invite")).toBe(
      "/members?members.role=Editor&members.page=2&action=invite",
    );
  });

  it("drops the query when going to another page", () => {
    expect(askingHere(HERE, "/groups", "action", "invite")).toBe("/groups?action=invite");
    const onGroups = { pathname: "/groups", searchStr: "?groups.search=ops" };
    expect(askingHere(onGroups, "/members", "action", "invite")).toBe("/members?action=invite");
  });

  it("reads a return URL's action under its legacy key", () => {
    const signedInAgain = new URLSearchParams("?search=priya%40acme.invalid&person=p1&act=correct");

    expect(askedIn(signedInAgain, "action")).toBe("correct");
  });
});
