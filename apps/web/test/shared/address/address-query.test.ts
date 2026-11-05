import { describe, expect, it } from "vitest";

import { ADDRESS_QUERY } from "@/shared/address/address-query.ts";

const { parseSearch, stringifySearch } = ADDRESS_QUERY;

describe("the URL query string", () => {
  it.each(["1.50", "1e3", "01", " 2"])("parses the search %s as a string", (typed) => {
    expect(parseSearch(`?search=${encodeURIComponent(typed)}`)).toEqual({ search: typed });
  });

  it("parses JSON values into numbers, booleans and strings", () => {
    expect(parseSearch("?page=2&on=true&search=%221.5%22")).toEqual({
      page: 2,
      on: true,
      search: "1.5",
    });
  });

  it.each(["1.50", "1.5", "audit logs", '"audit"'])(
    "round-trips the search %s unchanged",
    (typed) => {
      expect(parseSearch(stringifySearch({ search: typed }))).toEqual({ search: typed });
    },
  );
});
