#!/usr/bin/env bash
# Usage: seed-knowledge.sh <port>
set -euo pipefail

port="${1:?usage: seed-knowledge.sh <port>}"
here="$(cd "$(dirname "$0")" && pwd)"
run="$(date +%s)$RANDOM"
domain="northbridge-safeguarding.example"

say() { echo "seed-knowledge: $*" >&2; }
harness() { "$here/harness.sh" "$port" "$@"; }
field() {
  node -e 'let value = JSON.parse(require("node:fs").readFileSync(0, "utf8")); for (const key of process.argv[1].split(".")) value = value[key]; console.log(value);' "$1"
}
iri_of() {
  node -e 'const found = JSON.parse(process.argv[1]).concepts.find((each) => each.title === process.argv[2]); if (found === undefined) { console.error("no seeded concept titled " + process.argv[2]); process.exit(1); } console.log(found.iri);' "$1" "$2"
}
member_of() {
  local person
  person="$(harness POST /people "{\"email\":\"$2.$run@$domain\",\"displayName\":\"$1\"}")"
  harness POST /members "{\"workspaceId\":\"$ws\",\"userId\":\"$(field id <<<"$person")\",\"role\":\"$3\"}" >/dev/null
  echo "$person"
}

say "making the workspace Northbridge Safeguarding and its Admin Priya Shah (run $run)"
workspace="$(harness POST /workspaces "{\"name\":\"Northbridge Safeguarding\",\"adminName\":\"Priya Shah\",\"adminEmail\":\"priya.shah.$run@$domain\"}")"
ws="$(field workspaceId <<<"$workspace")"
admin="$(field admin.id <<<"$workspace")"
admin_email="$(field admin.email <<<"$workspace")"

say "adding the Editor Ifan Morgan and the Viewer Hannah Doyle"
editor="$(member_of "Ifan Morgan" ifan.morgan Editor)"
viewer="$(member_of "Hannah Doyle" hannah.doyle Viewer)"
editor_id="$(field id <<<"$editor")"

say "seeding 15 concepts in sectors, products, corporate, policies and answers"
concepts_asked="$(
  cat <<'JSON'
{"workspaceId":"@WS@","userId":"@ADMIN@","concepts":[
{"title":"Schools and multi-academy trusts","collection":"sectors","kind":"sector",
 "body":"Northbridge Safeguarding supports maintained schools, academies and multi-academy trusts across the North of England. We audit their safeguarding, train their Designated Safeguarding Leads and keep each trust's single central record under review.",
 "frontmatter":{"description":"The schools and multi-academy trusts Northbridge serves.","tags":["schools","multi-academy-trusts","education"]}},
{"title":"Section 11 audits","collection":"products","kind":"service",
 "body":"A Section 11 audit tests how well a school or trust meets its duty under section 11 of the Children Act 2004. A Northbridge auditor reviews policies, training records and the single central record, interviews staff and pupils, and reports to the local Safeguarding Children Partnership within four weeks.",
 "sources":[{"title":"Service catalogue 2025.pdf","at":"p.2"}],
 "verifications":[{"at":"2026-04-08T09:00:00Z"}],
 "frontmatter":{"description":"Our audit of a school's duties under section 11 of the Children Act 2004.","tags":["audit","section-11","safeguarding"],"generated":[{"by":"okf-extract/0.4","at":"2026-02-10"}]}},
{"title":"Safer recruitment reviews","collection":"products","kind":"service",
 "body":"A safer recruitment review checks that a school hires staff in line with Keeping Children Safe in Education. We sample recruitment files, test the single central record and confirm that at least one panel member has completed safer recruitment training.",
 "verifications":[{"by":"@ADMIN@","at":"2026-05-14T11:15:00Z"}],
 "frontmatter":{"description":"A review of how a school recruits and vets its staff.","tags":["safer-recruitment","kcsie","safeguarding"],"generated":[{"by":"okf-extract/0.4","at":"2026-02-10"}]}},
{"title":"Designated Safeguarding Lead training","collection":"products","kind":"service",
 "body":"Our Designated Safeguarding Lead course runs for two days, in person or online. It covers referral thresholds, record keeping, working with the local authority and the lead's duty to supervise staff. Each delegate receives a certificate that stays valid for two years.",
 "frontmatter":{"description":"Two-day training for a school's Designated Safeguarding Lead.","tags":["dsl","training","safeguarding"]}},
{"title":"Learning management system","collection":"products","kind":"service",
 "body":"Northbridge Learn is our learning management system. Schools assign courses to staff, track completion and download certificates. It supports single sign-on from Microsoft 365 and Google Workspace, and keeps training records for seven years.",
 "frontmatter":{"description":"The online system where a school's staff take and record their training.","tags":["lms","e-learning","training"],"bid_reference":"NB-LMS-2026-014","region":"North of England"}},
{"title":"Safeguarding Children Partnerships","collection":"sectors","kind":"sector",
 "body":"Northbridge works with Safeguarding Children Partnerships across Yorkshire and the North East. We prepare schools for the partnership's Section 11 audit[^source-1] and follow the statutory guidance in Working Together to Safeguard Children[^source-2]. A partnership brings together the local authority, the police and health commissioners, and publishes the multi-agency procedures our clients follow.",
 "sources":[{"title":"SCP tender 2025.pdf","at":"p.4"},{"title":"Working Together to Safeguard Children 2023","at":"ch.2"}],
 "linksTo":["Schools and multi-academy trusts","Section 11 audits","Safer recruitment reviews"],
 "verifications":[{"at":"2026-02-12T10:00:00Z"},{"by":"@ADMIN@","at":"2026-03-03T14:30:00Z"}],
 "frontmatter":{"description":"How Northbridge works with the local Safeguarding Children Partnerships.","tags":["safeguarding","partnerships","section-11"],"generated":[{"by":"okf-extract/0.4","at":"2026-02-10"}]}},
{"title":"Registered company number","collection":"corporate","kind":"company fact",
 "body":"Northbridge Safeguarding Ltd is registered in England and Wales under company number 09214367. Its registered office is Mill House, 14 Calder Street, Wakefield WF1 2AB.",
 "sources":[{"title":"Companies House record","at":"filing history"}],
 "verifications":[{"at":"2026-01-20T08:30:00Z"}],
 "frontmatter":{"description":"The company number and registered office of Northbridge Safeguarding Ltd.","tags":["registration","company"]}},
{"title":"Public liability insurance","collection":"corporate","kind":"insurance policy",
 "body":"Northbridge holds public liability insurance of ten million pounds for any one occurrence, placed with a UK insurer. The policy covers our work on school premises and at training venues, and the insurer issues a certificate each year.",
 "sources":[{"title":"Public liability certificate 2025-26.pdf","at":"p.1"}],
 "verifications":[{"by":"@ADMIN@","at":"2025-07-01T09:00:00Z"}],
 "frontmatter":{"description":"Our public liability cover, its limit and what it covers.","tags":["public-liability","insurance"],"stale_after":"2026-06-30"}},
{"title":"Professional indemnity insurance","collection":"corporate","kind":"insurance policy",
 "body":"Northbridge holds professional indemnity insurance of five million pounds for any one claim. It covers advice given in audits, reviews and training, and it renews each October.",
 "frontmatter":{"description":"Our professional indemnity cover, its limit and what it covers.","tags":["professional-indemnity","insurance"]}},
{"title":"Data protection policy","collection":"corporate","kind":"policy",
 "body":"Northbridge processes pupil and staff data as a processor for its clients and as a controller for its own staff. We follow UK GDPR and the Data Protection Act 2018, keep personal data in UK data centres and report a breach to the ICO within 72 hours.",
 "sources":[{"title":"Data protection policy v4.docx","at":"s.3"}],
 "verifications":[{"at":"2026-03-18T13:00:00Z"}],
 "frontmatter":{"description":"How Northbridge handles personal data and reports a breach.","tags":["privacy","data-protection","gdpr"]}},
{"title":"Safeguarding escalation contacts","collection":"policies","kind":"procedure","sensitivity":"Restricted",
 "body":"Out of hours, call the Northbridge duty Designated Safeguarding Lead on the number held in the on-call rota, then the local authority designated officer. Do not share these numbers outside the company.",
 "frontmatter":{"description":"Who to call out of hours when a safeguarding concern cannot wait.","tags":["safeguarding","escalation"]}},
{"title":"Safeguarding policy 2023","collection":"policies","kind":"policy","status":"deprecated",
 "body":"This policy set out how Northbridge staff report and record a concern about a child. The current safeguarding policy replaces it.",
 "sources":[{"title":"Safeguarding policy 2023.pdf","at":"p.1"}],
 "verifications":[{"by":"@ADMIN@","at":"2024-09-02T10:00:00Z"}],
 "frontmatter":{"description":"The 2023 version of our safeguarding policy, now replaced.","tags":["safeguarding","policy"]}},
{"title":"Safeguarding policy","collection":"policies","kind":"policy",
 "body":"Every Northbridge employee who has a concern about a child tells the Designated Safeguarding Lead the same day and records it in writing. The lead decides whether to refer to children's social care and records the reason. This policy replaces the 2023 policy and follows Keeping Children Safe in Education 2025.",
 "sources":[{"concept":"Safeguarding policy 2023"},{"title":"Keeping Children Safe in Education 2025","at":"part 1"}],
 "linksTo":["Safeguarding escalation contacts"],
 "frontmatter":{"description":"What a Northbridge employee does when they have a concern about a child.","tags":["safeguarding","policy"]}},
{"title":"Do you carry public liability insurance?","collection":"answers","kind":"answer",
 "body":"Yes. Northbridge holds public liability insurance of ten million pounds for any one occurrence, and we can supply the insurer's certificate on request.",
 "sources":[{"concept":"Public liability insurance"}],
 "linksTo":["Public liability insurance"],
 "verifications":[{"at":"2026-05-02T09:30:00Z"}],
 "frontmatter":{"description":"The standard answer to a bid question about public liability cover.","tags":["insurance","bid-answer"]}},
{"title":"How do you train Designated Safeguarding Leads?","collection":"answers","kind":"answer",
 "body":"We run a two-day Designated Safeguarding Lead course in person or online, and delegates book and record it in our learning management system. The certificate stays valid for two years.",
 "sources":[{"concept":"Designated Safeguarding Lead training"}],
 "linksTo":["Designated Safeguarding Lead training","Learning management system"],
 "frontmatter":{"description":"The standard answer to a bid question about safeguarding training.","tags":["safeguarding","training","bid-answer"]}}
]}
JSON
)"
concepts_asked="${concepts_asked//@WS@/$ws}"
concepts_asked="${concepts_asked//@ADMIN@/$admin}"
seeded="$(harness POST /concepts "$concepts_asked")"
dp_iri="$(iri_of "$seeded" "Data protection policy")"

say "naming Ifan Morgan the owner of products and Priya Shah the owner of the Data protection policy"
harness POST /owners "{\"workspaceId\":\"$ws\",\"userId\":\"$admin\",\"owners\":[{\"collection\":\"products\",\"personId\":\"$editor_id\"},{\"iri\":\"$dp_iri\",\"personId\":\"$admin\"}]}" >/dev/null

say "seeding the bid-library guide over corporate"
guide="$(harness POST /guides "{\"workspaceId\":\"$ws\",\"userId\":\"$admin\",\"collection\":\"corporate\"}")"

say "seeding the connected source Northbridge SharePoint"
harness POST /connected-sources "{\"workspaceId\":\"$ws\",\"connectedSources\":[{\"name\":\"Northbridge SharePoint\",\"sensitivity\":\"Internal\",\"sync\":\"done\",\"published\":true,\"documents\":[{\"title\":\"SCP tender pack 2025.docx\"}]}]}" >/dev/null

say "recording four questions that cite the concepts"
scp_iri="$(iri_of "$seeded" "Safeguarding Children Partnerships")"
pl_iri="$(iri_of "$seeded" "Public liability insurance")"
pl_answer_iri="$(iri_of "$seeded" "Do you carry public liability insurance?")"
audit_iri="$(iri_of "$seeded" "Section 11 audits")"
dsl_iri="$(iri_of "$seeded" "Designated Safeguarding Lead training")"
dsl_answer_iri="$(iri_of "$seeded" "How do you train Designated Safeguarding Leads?")"
policy_iri="$(iri_of "$seeded" "Safeguarding policy")"
schools_iri="$(iri_of "$seeded" "Schools and multi-academy trusts")"
harness POST /questions "{\"workspaceId\":\"$ws\",\"records\":[
{\"askedBy\":\"$admin\",\"question\":\"Do we carry public liability insurance?\",\"verdict\":\"ok\",\"concepts\":[{\"iri\":\"$pl_iri\",\"tier\":\"human-reviewed\"},{\"iri\":\"$pl_answer_iri\",\"tier\":\"machine-confirmed\"}]},
{\"askedBy\":\"$admin\",\"question\":\"How do we train Designated Safeguarding Leads?\",\"verdict\":\"ok\",\"concepts\":[{\"iri\":\"$dsl_iri\"},{\"iri\":\"$dsl_answer_iri\"},{\"iri\":\"$policy_iri\"}]},
{\"askedBy\":\"$admin\",\"question\":\"Which Safeguarding Children Partnerships do we work with?\",\"verdict\":\"ok\",\"concepts\":[{\"iri\":\"$scp_iri\",\"tier\":\"human-reviewed\"},{\"iri\":\"$schools_iri\"}]},
{\"askedBy\":\"$editor_id\",\"question\":\"What does a Section 11 audit involve?\",\"verdict\":\"ok\",\"concepts\":[{\"iri\":\"$audit_iri\",\"tier\":\"machine-confirmed\"},{\"iri\":\"$scp_iri\",\"tier\":\"human-reviewed\"}]}
]}" >/dev/null

say "done; sign in with sign-in.sh $port <Admin email> <a concept page path below>"
echo -e "workspace\t$ws\tNorthbridge Safeguarding"
echo -e "admin\t$admin_email\tPriya Shah"
echo -e "editor\t$(field email <<<"$editor")\tIfan Morgan\towns the collection products"
echo -e "viewer\t$(field email <<<"$viewer")\tHannah Doyle"
echo -e "guide\t$(field guideId <<<"$guide")\tbid-library over corporate"
echo -e "connected source\tNorthbridge SharePoint\tpublished, sync done, one document"
echo
echo -e "title\tiri\tpage path"
node -e '
const seeded = JSON.parse(process.argv[2]).concepts;
for (const concept of seeded) {
  console.log([concept.title, concept.iri, "/knowledge/search/" + concept.iri.split("/").pop()].join("\t"));
}
const asked = JSON.parse(process.argv[1]).concepts;
const now = new Date().toISOString();
const newest = (concept) => [...concept.verifications].sort((a, b) => b.at.localeCompare(a.at))[0];
const tierOf = (concept) =>
  concept.verifications === undefined
    ? (concept.trust ?? "unverified")
    : newest(concept).by === undefined ? "machine-confirmed" : "human-reviewed";
const known = ["description", "tags", "stale_after", "generated"];
const states = {
  "human-reviewed": (c) => tierOf(c) === "human-reviewed",
  "machine-confirmed": (c) => tierOf(c) === "machine-confirmed",
  "unverified": (c) => tierOf(c) === "unverified",
  "history of earlier verifications": (c) => (c.verifications ?? []).length > 1,
  "deprecated": (c) => c.status === "deprecated",
  "out of date": (c) => (c.frontmatter.stale_after ?? "9999") < now,
  "no sources": (c) => (c.sources ?? []).length === 0,
  "generated by okf-extract/0.4": (c) => c.frontmatter.generated !== undefined,
  "other fields": (c) => Object.keys(c.frontmatter).some((key) => !known.includes(key)),
  "restricted, hidden from the Viewer": (c) => c.sensitivity === "Restricted",
  "owned by Priya Shah": (c) => c.title === "Data protection policy",
  "owned by Ifan Morgan through products": (c) => c.collection === "products",
  "counted in the guide": (c) => c.collection === "corporate",
};
console.log("");
console.log("state\ttitles");
for (const [state, holds] of Object.entries(states)) {
  console.log(state + "\t" + asked.filter(holds).map((c) => c.title).join("; "));
}
' "$concepts_asked" "$seeded"
