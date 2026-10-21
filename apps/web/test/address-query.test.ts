import { describe, expect, it } from "vitest";

import { ADDRESS_QUERY } from "@/shared/address-query.ts";

const { parseSearch, stringifySearch } = ADDRESS_QUERY;

describe("the address's query", () => {
  it.each(["1.50", "1e3", "01", " 2"])("reads %s as typed", (typed) => {
    expect(parseSearch(`?search=${encodeURIComponent(typed)}`)).toEqual({ search: typed });
  });

  it("reads what JSON writes as JSON", () => {
    expect(parseSearch("?page=2&on=true&search=%221.5%22")).toEqual({
      page: 2,
      on: true,
      search: "1.5",
    });
  });

  it.each(["1.50", "1.5", "audit logs", '"audit"'])("writes %s back as itself", (typed) => {
    expect(parseSearch(stringifySearch({ search: typed }))).toEqual({ search: typed });
  });
});
