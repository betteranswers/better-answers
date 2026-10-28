import { parseSearchWith, stringifySearchWith } from "@tanstack/react-router";
import { z } from "zod";

type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json };

const asJsonWritesIt = (value: string): Json => {
  const read: Json = z.json().parse(JSON.parse(value));
  if (JSON.stringify(read) !== value) throw new SyntaxError(`${value} is not as JSON writes it`);
  return read;
};

export const asWritten = (held: unknown): string | undefined =>
  typeof held === "string" ? held : JSON.stringify(held);

export const ADDRESS_QUERY = {
  parseSearch: parseSearchWith(asJsonWritesIt),
  stringifySearch: stringifySearchWith(JSON.stringify, asJsonWritesIt),
};
