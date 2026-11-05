import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useMemo } from "react";
import { z } from "zod";

import { asWritten } from "@/shared/address/address-query.ts";

type Held = string | number | undefined;

/** `ignoreBlocker` lets an editor update the address without triggering the unsaved-changes prompt. */
export type WriteOptions = { readonly ignoreBlocker?: boolean };

export type ListFields = Readonly<Record<string, z.ZodCatch<z.ZodType<Held>>>>;

type AddressState<Fields extends ListFields> = z.output<z.ZodObject<Fields>>;

/** The router parses a whole number as a number, so a quoted page number is also malformed. */
export const PAGE_NUMBER = z.number().int().min(1).catch(1);

export const searchText = (max = Number.POSITIVE_INFINITY) =>
  z.preprocess(asWritten, z.string().max(max)).catch("");

export type SearchText = ReturnType<typeof searchText>;

const QUERY = z.record(z.string(), z.unknown());

type Query = z.output<typeof QUERY>;

const keyOf = (prefix: string, field: string): string => `${prefix}.${field}`;

const fieldsHeld = (prefix: string, fields: ListFields, query: Query): Query =>
  Object.fromEntries(Object.keys(fields).map((field) => [field, query[keyOf(prefix, field)]]));

const written = (
  prefix: string,
  defaults: Query,
  patch: readonly (readonly [string, unknown])[],
): Query =>
  Object.fromEntries(
    patch.map(([field, value]) => [
      keyOf(prefix, field),
      value === defaults[field] ? undefined : value,
    ]),
  );

export const useListAddress = <Fields extends ListFields>(prefix: string, fields: Fields) => {
  const search = useRouterState({ select: (state) => state.location.search });
  const navigate = useNavigate();
  const shape = useMemo(() => z.object(fields), [fields]);
  const defaults: Query = useMemo(() => shape.parse({}), [shape]);
  const state: AddressState<Fields> = useMemo(
    () => shape.parse(fieldsHeld(prefix, fields, QUERY.parse(search))),
    [shape, prefix, fields, search],
  );

  const writeHeld = (
    patch: readonly (readonly [string, unknown])[],
    options: WriteOptions = {},
  ): void => {
    void navigate({
      to: ".",
      search: (current: Query) => ({ ...current, ...written(prefix, defaults, patch) }),
      replace: true,
      ignoreBlocker: options.ignoreBlocker === true,
    });
  };

  const write = (patch: Partial<AddressState<Fields>>, options?: WriteOptions): void => {
    writeHeld(Object.entries(patch), options);
  };

  return { state, write, writeHeld };
};
