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
  guideType: "Bid library",
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
        { name: "Company registration", conceptType: "company fact", tags: ["registration"] },
        { name: "Headcount", conceptType: "company fact", tags: ["headcount"] },
        { name: "Year founded", conceptType: "company fact", tags: ["founded"] },
        { name: "Registered office", conceptType: "company fact", tags: ["office"] },
      ],
    }),
    section({
      key: "what-we-offer",
      prompt: "What we offer",
      roleLabel: "say",
      usageNote: "Name what the company sells in the words a buyer uses.",
      layers: BOTH_LAYERS,
      expects: [
        { name: "Services", conceptType: "service", tags: [], atLeast: 2 },
        { name: "Sectors served", conceptType: "sector", tags: ["served"] },
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
          conceptType: "insurance policy",
          tags: ["public-liability"],
        },
        {
          name: "Professional indemnity insurance",
          conceptType: "insurance policy",
          tags: ["professional-indemnity"],
        },
        {
          name: "Employers' liability insurance",
          conceptType: "insurance policy",
          tags: ["employers-liability"],
        },
        { name: "Filed accounts", conceptType: "company fact", tags: ["accounts"] },
      ],
    }),
    section({
      key: "certifications",
      prompt: "Certifications",
      roleLabel: "show",
      usageNote: null,
      layers: QUOTED_ALONE,
      expects: [
        { name: "ISO 27001 certificate", conceptType: "certification", tags: ["iso-27001"] },
        {
          name: "Cyber Essentials Plus certificate",
          conceptType: "certification",
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
        {
          name: "Data protection registration",
          conceptType: "registration",
          tags: ["data-protection"],
        },
        { name: "Privacy policy", conceptType: "policy", tags: ["privacy"] },
        { name: "Data location", conceptType: "company fact", tags: ["data-location"] },
      ],
    }),
    section({
      key: "information-security",
      prompt: "Information security",
      roleLabel: "know",
      usageNote: "Say how the company keeps information safe, then show the evidence.",
      layers: BOTH_LAYERS,
      expects: [
        { name: "Security practices", conceptType: "practice", tags: ["security"], atLeast: 2 },
        {
          name: "Cyber Essentials Plus certificate",
          conceptType: "certification",
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
              conceptType: "practice",
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
        { name: "Incident severity levels", conceptType: "service level", tags: ["severity"] },
        { name: "Support hours", conceptType: "company fact", tags: ["support-hours"] },
        { name: "Escalation path", conceptType: "practice", tags: ["escalation"] },
      ],
    }),
  ],
};
