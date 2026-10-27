import { assert, describe, expect, it } from "vitest";

import { guideRowsOf, TEMPLATES } from "../src/guides/index.ts";

const counter = (): (() => string) => {
  let minted = 0;
  return () => {
    minted += 1;
    return `minted-${minted}`;
  };
};

const PLACED = {
  guideId: "01J9GUIDE00000000000000000",
  collection: "company",
  subjectIri: null,
} as const;

const role = (name: string, defaultLayer: string, actionThreshold: string) => ({
  role: name,
  defaultLayer,
  actionThreshold,
});

const section = (
  id: string,
  parentId: string | null,
  ordinal: number,
  prompt: string,
  roleLabel: string,
  usageNote: string | null,
  layers: readonly string[],
) => ({ id, parentId, ordinal, prompt, roleLabel, usageNote, layers, hidden: false });

const fact = (
  id: string,
  sectionId: string,
  ordinal: number,
  name: string,
  kind: string,
  tags: readonly string[],
  atLeast = 1,
) => ({ id, sectionId, ordinal, name, kind, tags, collection: null, atLeast });

describe("the shipped templates", () => {
  it("parses every shipped template into expected fact rows", () => {
    expect([...TEMPLATES.keys()]).toEqual(["bid-library"]);
    const template = TEMPLATES.get("bid-library");
    assert(template !== undefined, "the bid-library template is not shipped");

    expect(guideRowsOf(template, PLACED, counter())).toEqual({
      definition: {
        id: "01J9GUIDE00000000000000000",
        template: "bid-library",
        kind: "Bid library",
        collection: "company",
        subjectIri: null,
      },
      roles: [
        role("Admin", "assembled", "unverified"),
        role("Editor", "assembled", "unverified"),
        role("Viewer", "quoted", "machine-confirmed"),
      ],
      sections: [
        section(
          "minted-1",
          null,
          0,
          "Company overview",
          "know",
          "Open with the facts a buyer checks before reading on.",
          ["assembled", "quoted"],
        ),
        section(
          "minted-6",
          null,
          1,
          "What we offer",
          "say",
          "Name what the company sells in the words a buyer uses.",
          ["assembled", "quoted"],
        ),
        section("minted-9", null, 2, "Insurance and financial standing", "show", null, ["quoted"]),
        section("minted-14", null, 3, "Certifications", "show", null, ["quoted"]),
        section("minted-17", null, 4, "Data protection", "know", null, ["assembled", "quoted"]),
        section(
          "minted-21",
          null,
          5,
          "Information security",
          "know",
          "Say how the company keeps information safe, then show the evidence.",
          ["assembled", "quoted"],
        ),
        section("minted-24", "minted-21", 0, "Security testing", "know", null, [
          "assembled",
          "quoted",
        ]),
        section(
          "minted-26",
          null,
          6,
          "Support and service levels",
          "do",
          "Say what a customer does when something goes wrong.",
          ["assembled", "quoted"],
        ),
      ],
      facts: [
        fact("minted-2", "minted-1", 0, "Company registration", "Company Fact", ["registration"]),
        fact("minted-3", "minted-1", 1, "Headcount", "Company Fact", ["headcount"]),
        fact("minted-4", "minted-1", 2, "Year founded", "Company Fact", ["founded"]),
        fact("minted-5", "minted-1", 3, "Registered office", "Company Fact", ["office"]),
        fact("minted-7", "minted-6", 0, "Services", "Service", [], 2),
        fact("minted-8", "minted-6", 1, "Sectors served", "Sector", ["served"]),
        fact("minted-10", "minted-9", 0, "Public liability insurance", "Insurance Policy", [
          "public-liability",
        ]),
        fact("minted-11", "minted-9", 1, "Professional indemnity insurance", "Insurance Policy", [
          "professional-indemnity",
        ]),
        fact("minted-12", "minted-9", 2, "Employers' liability insurance", "Insurance Policy", [
          "employers-liability",
        ]),
        fact("minted-13", "minted-9", 3, "Filed accounts", "Company Fact", ["accounts"]),
        fact("minted-15", "minted-14", 0, "ISO 27001 certificate", "Certification", ["iso-27001"]),
        fact("minted-16", "minted-14", 1, "Cyber Essentials Plus certificate", "Certification", [
          "cyber-essentials-plus",
        ]),
        fact("minted-18", "minted-17", 0, "Data protection registration", "Registration", [
          "data-protection",
        ]),
        fact("minted-19", "minted-17", 1, "Privacy policy", "Policy", ["privacy"]),
        fact("minted-20", "minted-17", 2, "Data location", "Company Fact", ["data-location"]),
        fact("minted-22", "minted-21", 0, "Security practices", "Practice", ["security"], 2),
        fact("minted-23", "minted-21", 1, "Cyber Essentials Plus certificate", "Certification", [
          "cyber-essentials-plus",
        ]),
        fact("minted-25", "minted-24", 0, "Security testing practices", "Practice", ["testing"], 2),
        fact("minted-27", "minted-26", 0, "Incident severity levels", "Service Level", [
          "severity",
        ]),
        fact("minted-28", "minted-26", 1, "Support hours", "Company Fact", ["support-hours"]),
        fact("minted-29", "minted-26", 2, "Escalation path", "Practice", ["escalation"]),
      ],
    });
  });
});
