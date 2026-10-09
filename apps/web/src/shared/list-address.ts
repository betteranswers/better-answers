import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useMemo } from "react";
import { z } from "zod";

/** What one key of the address holds: a word, a number, or nothing at all. */
type Held = string | number | undefined;

/** Each field's `.catch` is the list's default for a missing or malformed value. */
export type ListFields = Readonly<Record<string, z.ZodCatch<z.ZodType<Held>>>>;

type AddressState<Fields extends ListFields> = z.output<z.ZodObject<Fields>>;

/** The router reads a whole number as one, so a page held as a quoted word is malformed too. */
export const PAGE_NUMBER = z.number().int().min(1).catch(1);

/** The query as the router parsed it, every page's keys together. */
const QUERY = z.record(z.string(), z.unknown());

type Query = z.output<typeof QUERY>;

const keyOf = (prefix: string, field: string): string => `${prefix}.${field}`;

const fieldsHeld = (prefix: string, fields: ListFields, query: Query): Query =>
  Object.fromEntries(Object.keys(fields).map((field) => [field, query[keyOf(prefix, field)]]));

/** A value back at its default leaves the address, so an untouched list keeps a bare one. */
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

/**
 * Read through the router's own parser, which quotes a word that would read as a number, so a
 * search comes back exactly as typed.
 */
export const useListAddress = <Fields extends ListFields>(prefix: string, fields: Fields) => {
  const search = useRouterState({ select: (state) => state.location.search });
  const navigate = useNavigate();
  const shape = useMemo(() => z.object(fields), [fields]);
  const defaults: Query = useMemo(() => shape.parse({}), [shape]);
  const state: AddressState<Fields> = useMemo(
    () => shape.parse(fieldsHeld(prefix, fields, QUERY.parse(search))),
    [shape, prefix, fields, search],
  );

  // Replaced, never pushed, so typing fills no history; read from the address at the write, so
  // two writes in one handler both land.
  const writeEntries = (patch: readonly (readonly [string, unknown])[]): void => {
    void navigate({
      to: ".",
      search: (current: Query) => ({ ...current, ...written(prefix, defaults, patch) }),
      replace: true,
    });
  };

  const write = (patch: Partial<AddressState<Fields>>): void => {
    writeEntries(Object.entries(patch));
  };

  /** For ground that knows some fields by name but not the list's whole shape. */
  const writeHeld = (patch: readonly (readonly [string, Held])[]): void => {
    writeEntries(patch);
  };

  return { state, write, writeHeld };
};
