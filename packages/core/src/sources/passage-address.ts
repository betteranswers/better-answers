import {
  parsedPassageLocator,
  passageLocatorOf,
  type PassageLocator,
} from "@better-answers/schema";

import { err, NOT_FOUND, ok, type Result } from "../kernel/index.ts";
import type { SourceRefusal } from "./vocabulary.ts";

const ORDINAL_DIGITS = 6;
const PASSAGE_ID_SEPARATOR = "#";

export type LocatorRefusal = SourceRefusal<"not-found">;

export type Locator = PassageLocator;

export const passageIdOf = (sourceDocumentId: string, ordinal: number): string =>
  `${sourceDocumentId}${PASSAGE_ID_SEPARATOR}${String(ordinal).padStart(ORDINAL_DIGITS, "0")}`;

export const locatorOf = passageLocatorOf;

export const parseLocator = (wire: string): Result<Locator, LocatorRefusal> => {
  const locator = parsedPassageLocator(wire);
  return locator === undefined ? err(NOT_FOUND) : ok(locator);
};

export const spanText = (text: string, locator: Locator): Result<string, LocatorRefusal> => {
  const points = Array.from(text);
  if (locator.charEnd > points.length) return err(NOT_FOUND);
  return ok(points.slice(locator.charStart, locator.charEnd).join(""));
};
