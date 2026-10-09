import { describe, expect, it } from "vitest";

import { boundarySchemas, conceptIriOf, ids, ulid } from "../src/index.ts";

describe("the branded ids, each its table's own column", () => {
  it("names each id by the column that defines its brand", () => {
    const defining = [
      ["workspaceId", ids.workspaceId, boundarySchemas.workspace.select.shape.id],
      ["userId", ids.userId, boundarySchemas.user.select.shape.id],
      ["groupId", ids.groupId, boundarySchemas.group.select.shape.id],
      ["connectedSourceId", ids.connectedSourceId, boundarySchemas.connectedSource.select.shape.id],
      ["writeUpId", ids.writeUpId, boundarySchemas.writeUp.select.shape.id],
      ["auditEventId", ids.auditEventId, boundarySchemas.auditEvent.select.shape.id],
      ["accessRequestId", ids.accessRequestId, boundarySchemas.accessRequest.select.shape.id],
      ["conceptIri", ids.conceptIri, boundarySchemas.conceptIndex.select.shape.iri],
    ] as const;

    expect(Object.keys(ids)).toEqual(defining.map(([name]) => name));
    expect(defining.filter(([, id, column]) => id !== column).map(([name]) => name)).toEqual([]);
  });
});

describe("a minted concept IRI", () => {
  it("is a concept IRI the registry's column accepts", () => {
    const minted = conceptIriOf(ulid());

    expect(ids.conceptIri.safeParse(minted)).toEqual({ success: true, data: minted });
  });

  it("refuses to mint from anything but a ULID", () => {
    expect(() => conceptIriOf("not-a-ulid")).toThrow("invalid_format");
    expect(() => conceptIriOf(ulid().toLowerCase())).toThrow("invalid_format");
  });
});
