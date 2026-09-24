import { ulid, type UserPrincipal } from "../src/kernel/index.ts";
import { bindUpload, bindUploadFields } from "../src/sources/index.ts";
import type { ObjectDoor } from "../src/store/objects/index.ts";
import type { PostgresDoor } from "../src/store/postgres/index.ts";
import { inputOf } from "./suite-input.ts";

export const THE_HANDBOOK =
  "# The depot handbook\n\n" +
  "Overtime is paid at time and a quarter after the fortieth hour.\n\n" +
  "The sort code is 00-00-00 and the account number is 12345678.\n";

export const THE_PASSAGE =
  "# The depot handbook\n\n" +
  "Overtime is paid at time and a quarter after the fortieth hour.\n\n" +
  "The sort code is [withheld].\n";

export const THE_BANK_DETAILS = "The sort code is 00-00-00 and the account number is 12345678.";

export const THE_SPAN_AS_FOUND = "00-00-00 and the account number is 12345678";

export const THE_SORT_CODE = "00-00-00";

export const THE_ACCOUNT_NUMBER = "12345678";

export const THE_PLACEHOLDER = "[withheld]";

export const THE_QUERY = "overtime";

export const THE_TITLE = "depot-handbook.md";

const THE_BINDING = "The depot handbook";

export type Span = { readonly start: number; readonly end: number };

export const THE_SPAN_AT: Span = { start: 104, end: 147 };

export const THE_WITHHELD_SPAN: Span = { start: 0, end: 116 };

export const THE_RESTORED_SPAN: Span = { start: 0, end: 149 };

export const locatorOf = (documentId: string, span: Span): string =>
  `${documentId}/chars:${String(span.start)}-${String(span.end)}`;

export type FindingGroupKey = {
  readonly documentId: string;
  readonly category: string;
  readonly ruleId: string;
  readonly tier: string;
};

export const bankDetailsGroupOf = (documentId: string): FindingGroupKey => ({
  documentId,
  category: "bank-details",
  ruleId: "UK_BANK_ACCOUNT",
  tier: "always",
});

const bodyOf = (text: string) =>
  new ReadableStream<Uint8Array>({
    pull: (controller) => {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });

export type BindingDoors = {
  readonly postgres: PostgresDoor;
  readonly objects: ObjectDoor;
};

export const bindTheHandbook = async (
  admin: UserPrincipal,
  doors: BindingDoors,
  called = THE_TITLE,
  text = THE_HANDBOOK,
) => {
  const bound = await bindUpload(admin, doors, {
    ...inputOf(bindUploadFields, {
      bindingId: ulid(),
      name: `${THE_BINDING} · ${called}`,
      fileName: called,
      mediaType: "text/markdown",
      byteSize: new TextEncoder().encode(text).length,
      sensitivity: "Internal",
    }),
    body: bodyOf(text),
  });
  if (!bound.ok) throw new Error(`the bind was refused: ${String(bound.error)}`);
  return bound.value;
};
