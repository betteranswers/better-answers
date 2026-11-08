export const NORTHGATE = {
  collection: "company",
  sections: 8,
  writeUps: 8,
  includesAtSeed: 24,
  includesOnceTyped: 25,
} as const;

export type Concept = {
  readonly key: string;
  readonly slug: string;
  readonly title: string;
  readonly conceptType: string;
  readonly tags: readonly string[];
  readonly body: string;
};

export const TYPED = [
  {
    key: "registration",
    slug: "registered-company-number",
    title: "Registered company number",
    conceptType: "company fact",
    tags: ["registration"],
    body: "Northgate Example Ltd is registered in England and Wales under company number 00000000.",
  },
  {
    key: "headcount",
    slug: "staff-headcount",
    title: "Staff headcount",
    conceptType: "company fact",
    tags: ["headcount"],
    body: "Northgate employs forty-two people, thirty of them engineers.",
  },
  {
    key: "founded",
    slug: "founded-in-2009",
    title: "Founded in 2009",
    conceptType: "company fact",
    tags: ["founded"],
    body: "Northgate was founded in 2009 and has traded without a break since.",
  },
  {
    key: "office",
    slug: "registered-office-address",
    title: "Registered office address",
    conceptType: "company fact",
    tags: ["office"],
    body: "The registered office is 1 Example Street, Exampletown, EX1 1EX.",
  },
  {
    key: "managedSupport",
    slug: "managed-it-support",
    title: "Managed IT support",
    conceptType: "service",
    tags: [],
    body: "Northgate runs the desktops, servers and networks of organisations of up to 500 staff.",
  },
  {
    key: "cloudMigration",
    slug: "cloud-migration",
    title: "Cloud migration",
    conceptType: "service",
    tags: [],
    body: "Northgate moves on-premises services to hosted platforms in planned stages.",
  },
  {
    key: "publicSector",
    slug: "public-sector-bodies",
    title: "Public sector bodies",
    conceptType: "sector",
    tags: ["served"],
    body: "Northgate serves councils, schools and health bodies.",
  },
  {
    key: "accessControl",
    slug: "access-control",
    title: "Access control",
    conceptType: "practice",
    tags: ["security"],
    body: "Every account is named, holds the least access its role needs and is reviewed each quarter.",
  },
  {
    key: "patchManagement",
    slug: "patch-management",
    title: "Patch management",
    conceptType: "practice",
    tags: ["security"],
    body: "Critical patches are applied within fourteen days of release.",
  },
  {
    key: "penetrationTesting",
    slug: "penetration-testing",
    title: "Penetration testing",
    conceptType: "practice",
    tags: ["testing"],
    body: "An accredited tester attacks the external estate once a year.",
  },
  {
    key: "vulnerabilityScanning",
    slug: "vulnerability-scanning",
    title: "Vulnerability scanning",
    conceptType: "practice",
    tags: ["testing"],
    body: "Every host is scanned for known vulnerabilities each week.",
  },
  {
    key: "severityLevels",
    slug: "incident-severity-levels",
    title: "Incident severity levels",
    conceptType: "service level",
    tags: ["severity"],
    body: "A severity 1 incident is answered within thirty minutes, a severity 4 within a day.",
  },
  {
    key: "supportHours",
    slug: "support-hours",
    title: "Support hours",
    conceptType: "company fact",
    tags: ["support-hours"],
    body: "The service desk answers from 08:00 to 18:00 on working days.",
  },
  {
    key: "escalationPath",
    slug: "escalation-path",
    title: "Escalation path",
    conceptType: "practice",
    tags: ["escalation"],
    body: "An unresolved incident goes to the service manager after four hours.",
  },
] as const satisfies readonly Concept[];

export const IMPORTED = [
  {
    key: "publicLiability",
    slug: "public-liability-policy",
    title: "Public liability policy",
    conceptType: "insurance policy",
    tags: ["public-liability"],
    body: "Northgate holds public liability cover of five million pounds.",
  },
  {
    key: "professionalIndemnity",
    slug: "professional-indemnity-policy",
    title: "Professional indemnity policy",
    conceptType: "insurance policy",
    tags: ["professional-indemnity"],
    body: "Northgate holds professional indemnity cover of two million pounds.",
  },
  {
    key: "accounts2024",
    slug: "filed-accounts-2024",
    title: "Filed accounts 2024",
    conceptType: "company fact",
    tags: ["accounts"],
    body: "The accounts for the year to March 2024 were filed on time.",
  },
  {
    key: "accounts2025",
    slug: "filed-accounts-2025",
    title: "Filed accounts 2025",
    conceptType: "company fact",
    tags: ["accounts"],
    body: "The accounts for the year to March 2025 were filed on time.",
  },
  {
    key: "iso27001",
    slug: "iso-27001-certificate",
    title: "ISO 27001 certificate",
    conceptType: "certification",
    tags: ["iso-27001"],
    body: "Northgate is certified to ISO 27001 for its whole service.",
  },
  {
    key: "cyberEssentialsPlus",
    slug: "cyber-essentials-plus-certificate",
    title: "Cyber Essentials Plus certificate",
    conceptType: "certification",
    tags: ["cyber-essentials-plus"],
    body: "Northgate holds Cyber Essentials Plus, renewed each year.",
  },
  {
    key: "icoRegistration",
    slug: "ico-registration",
    title: "ICO registration",
    conceptType: "registration",
    tags: ["data-protection"],
    body: "Northgate is registered with the Information Commissioner's Office.",
  },
  {
    key: "privacyNotice",
    slug: "privacy-notice",
    title: "Privacy notice",
    conceptType: "policy",
    tags: ["privacy"],
    body: "The privacy notice says what personal data Northgate holds and why.",
  },
  {
    key: "dataLocation",
    slug: "where-data-is-held",
    title: "Where data is held",
    conceptType: "company fact",
    tags: ["data-location"],
    body: "Customer data is held in two data centres in the United Kingdom.",
  },
] as const satisfies readonly Concept[];

export type ImportedKey = (typeof IMPORTED)[number]["key"];

export const VERIFIED_AT_IMPORT: ReadonlySet<ImportedKey> = new Set([
  "publicLiability",
  "professionalIndemnity",
  "accounts2024",
  "accounts2025",
]);

export const EMPLOYERS_LIABILITY = {
  key: "employersLiability",
  slug: "employers-liability-policy",
  title: "Employers' liability policy",
  conceptType: "insurance policy",
  tags: ["employers-liability"],
  body: "Northgate holds employers' liability cover of ten million pounds.",
} as const satisfies Concept;
