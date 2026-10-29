import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SEARCH_PAGE as SEARCH } from "@/shared/knowledge/concept-address.ts";
import { HOMES, type Role } from "@/shared/navigation.ts";
import { adaAt, openAt } from "@test/two-workspaces.ts";

import {
  aSearchApi,
  finding,
  findsAsked,
  foundNothing,
  matchRows,
  openedSearch,
  placedForSearch,
  said,
  saidNow,
  searchBox,
  typed,
  AUDIT_COMMITTEE,
  AUDIT_LOGS_RETENTION,
  FORKLIFT_LICENCES,
  knowledgeRailPressed,
  listsOnly,
  textOfRows,
} from "./search-answers.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedForSearch();

const A_ROLE = { Editor: "an Editor", Viewer: "a Viewer" } as const satisfies Partial<
  Readonly<Record<Role, string>>
>;

describe("the Knowledge Search page", () => {
  it("writes the settled query to the address, kept by reload", async () => {
    const api = aSearchApi();
    api.set(
      "knowledge.find",
      finding({ "audit log retention": [AUDIT_LOGS_RETENTION, AUDIT_COMMITTEE] }),
    );
    const router = await openedSearch(api);

    typed("audit log retention");
    await waitFor(() =>
      expect(router.state.location.searchStr).toMatch(
        /knowledge\.search=audit(?:\+|%20)log(?:\+|%20)retention/,
      ),
    );
    await waitFor(() => expect(matchRows()[0]?.textContent).toContain("Audit Logs Retention"));
    const shown = textOfRows();
    const address = router.state.location.href;

    cleanup();
    await openedSearch(api, address);

    expect(searchBox().value).toBe("audit log retention");
    await waitFor(() => expect(matchRows()[0]?.textContent).toContain("Audit Logs Retention"));
    expect(textOfRows(), "the reload drew other matches").toEqual(shown);
    expect(findsAsked().map((asked) => asked.query)).toEqual(["audit log retention"]);
  });

  it("shows the nothing-asked state and sends no request", async () => {
    const api = aSearchApi();
    const router = await openedSearch(api);

    await waitFor(() => expect(saidNow()).toMatch(/\S/));
    expect(matchRows()).toHaveLength(0);
    const nothingAsked = saidNow();

    typed("   ");
    await waitFor(() =>
      expect(router.state.location.searchStr).toMatch(/knowledge\.search=(?:\+|%20){3}/),
    );
    expect(saidNow(), "a blank search is not said as nothing asked").toBe(nothingAsked);
    expect(findsAsked(), "the page asked for matches with nothing asked").toHaveLength(0);

    await foundNothing(api, "audit");
    expect(
      findsAsked().map((asked) => asked.query),
      "the page asked for more than the one search typed",
    ).toEqual(["audit"]);
  });

  it("takes a search another place asked for", async () => {
    const api = aSearchApi();
    api.set("knowledge.find", finding({ forklift: [FORKLIFT_LICENCES] }));

    const router = await openedSearch(api, `${SEARCH.path}?search=forklift`);

    await waitFor(() => expect(searchBox().value).toBe("forklift"));
    await listsOnly("Forklift Licences");
    await waitFor(() => expect(router.state.location.searchStr).not.toMatch(/[?&]search=/));
    expect(findsAsked().map((asked) => asked.query)).toEqual(["forklift"]);
  });

  it("says nothing matches, for stop words alone too", async () => {
    const api = aSearchApi();
    await openedSearch(api);

    await foundNothing(api, "zzz-nowhere");
    await foundNothing(api, "the and of");
    expect(said().textContent).toContain("the and of");
  });

  for (const role of ["Editor", "Viewer"] as const) {
    it(`takes ${A_ROLE[role]} to Search from the rail`, async () => {
      const api = aSearchApi();
      api.set("session.member", () => adaAt(role));
      const router = await openAt(HOMES[role].path, api);
      expect(router.state.location.pathname).toBe(HOMES[role].path);
      expect(await screen.findByRole("heading", { level: 1, name: "Ask" })).toBeDefined();

      knowledgeRailPressed();

      await waitFor(() => expect(router.state.location.pathname).toBe(SEARCH.path));
      expect(await screen.findByRole("heading", { level: 1, name: "Browse" })).toBeDefined();
      expect(
        within(screen.getByRole("navigation", { name: "Knowledge" }))
          .getAllByRole("link")
          .map((link) => link.textContent),
      ).toEqual(["Search", "Knowledge Base"]);
      expect(saidNow()).toMatch(/\S/);
      expect(matchRows()).toHaveLength(0);
    });
  }
});
