import type { SectionTemplate, Template } from "./template.ts";

const BOTH_LAYERS = ["assembled", "quoted"] as const;

const QUOTED_ALONE = ["quoted"] as const;

const section = (
  fields: Omit<SectionTemplate, "hidden" | "sections"> & {
    readonly sections?: readonly SectionTemplate[];
  },
): SectionTemplate => ({ hidden: false, sections: [], ...fields });

export const BID_LIBRARY: Template = {
  id: "bid-library",
  kind: "Bid library",
  roles: [
    { role: "Admin", defaultLayer: "assembled", actionThreshold: "unverified" },
    { role: "Editor", defaultLayer: "assembled", actionThreshold: "unverified" },
    { role: "Viewer", defaultLayer: "quoted", actionThreshold: "machine-confirmed" },
  ],
  sections: [
    section({
      key: "company-overview",
      prompt: "Company overview",
      roleLabel: "know",
      usageNote: "Open with the facts a buyer checks before reading on.",
      layers: BOTH_LAYERS,
      expects: [
        { name: "Company registration", kind: "company fact", tags: ["registration"] },
        { name: "Headcount", kind: "company fact", tags: ["headcount"] },
        { name: "Year founded", kind: "company fact", tags: ["founded"] },
        { name: "Registered office", kind: "company fact", tags: ["office"] },
      ],
    }),
    section({
      key: "what-we-offer",
      prompt: "What we offer",
      roleLabel: "say",
      usageNote: "Name what the company sells in the words a buyer uses.",
      layers: BOTH_LAYERS,
      expects: [
        { name: "Services", kind: "service", tags: [], atLeast: 2 },
        { name: "Sectors served", kind: "sector", tags: ["served"] },
      ],
    }),
    section({
      key: "insurance-and-financial-standing",
      prompt: "Insurance and financial standing",
      roleLabel: "show",
      usageNote: null,
      layers: QUOTED_ALONE,
      expects: [
        {
          name: "Public liability insurance",
          kind: "insurance policy",
          tags: ["public-liability"],
        },
        {
          name: "Professional indemnity insurance",
          kind: "insurance policy",
          tags: ["professional-indemnity"],
        },
        {
          name: "Employers' liability insurance",
          kind: "insurance policy",
          tags: ["employers-liability"],
        },
        { name: "Filed accounts", kind: "company fact", tags: ["accounts"] },
      ],
    }),
    section({
      key: "certifications",
      prompt: "Certifications",
      roleLabel: "show",
      usageNote: null,
      layers: QUOTED_ALONE,
      expects: [
        { name: "ISO 27001 certificate", kind: "certification", tags: ["iso-27001"] },
        {
          name: "Cyber Essentials Plus certificate",
          kind: "certification",
          tags: ["cyber-essentials-plus"],
        },
      ],
    }),
    section({
      key: "data-protection",
      prompt: "Data protection",
      roleLabel: "know",
      usageNote: null,
      layers: BOTH_LAYERS,
      expects: [
        { name: "Data protection registration", kind: "registration", tags: ["data-protection"] },
        { name: "Privacy policy", kind: "policy", tags: ["privacy"] },
        { name: "Data location", kind: "company fact", tags: ["data-location"] },
      ],
    }),
    section({
      key: "information-security",
      prompt: "Information security",
      roleLabel: "know",
      usageNote: "Say how the company keeps information safe, then show the evidence.",
      layers: BOTH_LAYERS,
      expects: [
        { name: "Security practices", kind: "practice", tags: ["security"], atLeast: 2 },
        {
          name: "Cyber Essentials Plus certificate",
          kind: "certification",
          tags: ["cyber-essentials-plus"],
        },
      ],
      sections: [
        section({
          key: "security-testing",
          prompt: "Security testing",
          roleLabel: "know",
          usageNote: null,
          layers: BOTH_LAYERS,
          expects: [
            {
              name: "Security testing practices",
              kind: "practice",
              tags: ["testing"],
              atLeast: 2,
            },
          ],
        }),
      ],
    }),
    section({
      key: "support-and-service-levels",
      prompt: "Support and service levels",
      roleLabel: "do",
      usageNote: "Say what a customer does when something goes wrong.",
      layers: BOTH_LAYERS,
      expects: [
        { name: "Incident severity levels", kind: "service level", tags: ["severity"] },
        { name: "Support hours", kind: "company fact", tags: ["support-hours"] },
        { name: "Escalation path", kind: "practice", tags: ["escalation"] },
      ],
    }),
  ],
};
