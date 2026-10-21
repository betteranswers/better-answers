import { parseSearchWith, stringifySearchWith } from "@tanstack/react-router";

type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json };

const asJsonWritesIt = (value: string): Json => {
  const read: Json = JSON.parse(value);
  if (JSON.stringify(read) !== value) throw new SyntaxError(`${value} is not as JSON writes it`);
  return read;
};

export const ADDRESS_QUERY = {
  parseSearch: parseSearchWith(asJsonWritesIt),
  stringifySearch: stringifySearchWith(JSON.stringify, asJsonWritesIt),
};
