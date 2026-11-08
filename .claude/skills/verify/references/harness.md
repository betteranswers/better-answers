# The harness routes the recipes call

`scripts/harness.sh` calls these under `/__harness`.

| Route | Body | Answer |
| --- | --- | --- |
| `POST /workspaces` | optional `name`, `adminEmail` and `adminName` (the Admin is named `Test person` unless told) | `workspaceId`, `name`, `shortName`, `admin` with `id`, `email`, `name` |
| `POST /people` | optional `email` and `displayName`; a person in no workspace | `id`, `email`, `name` |
| `POST /members` | `workspaceId`, `userId`, `role` of `Admin`, `Editor` or `Viewer` | `{"added":true}` |
| `POST /invitations` | `workspaceId`, `email`, `inviterId`, `role` | `id` |
| `POST /concepts` | `workspaceId`, `userId`, `concepts` of `title`, `body`, optional `collection`, `kind`, `trust`, `verifications`, `status` (`stable` unless named) | `concepts` with `iri`, `title`, `path`, `documents` |
| `POST /owners` | `workspaceId`, `userId` of an Admin, `owners` of `collection` or `iri`, and `personId` or `null` | `{"named":<number of owners>}` |
| `POST /manifest` | `workspaceId`, `userId` of an Admin | `{"written":true}`, a bundle manifest committed at the knowledge base's head (an imported knowledge base has one, a typed one does not) |
| `POST /guides` | `workspaceId`, `userId` of an Admin, `financeUserIds` of members to place in the group `finance`; or `collection` alone | `guideId`, `groupId`, `sections` with `sectionId`, `writeUpId`, `prompt`, `includes` of `id`, `iri`, `title`, and `concepts` mapping each title to its `iri`. With `collection`, only `guideId` and `sections` |
| `POST /usage` | `workspaceId`, `writeUpId` | `usage`, the write-up's rows with `id`, `actor`, `at`, `act`, `writeUpId`, `version`, `iri` |
| `POST /suggestions` | `workspaceId`, `userId`, `iri`, optional `title` and `body` | `suggestionId`, `setId` |
| `POST /groups` | `workspaceId`, `userId`, `names`, optional `memberIds` | `{"made":<number of names>}` |
| `POST /connected-sources` | `workspaceId`, `connectedSources` of `name`, optional `sensitivity`, `sync` (`none`, `queued`, `claimed` or `done`) and `documents` of `title` | `connectedSources` with `connectedSourceId`, `name`, `documents` |
| `POST /model-choices` | `workspaceId`, `modelChoices` of `purpose`, `provider`, `model` | `{"seeded":<number>}` |
| `POST /questions` | `workspaceId`, `records` of `question`, `verdict`, optional `flags` of `reason` and `note` | `records` with `recordId`, `flagIds` |
| `POST /operators` | `email`, `change` of `grant` or `revoke` | `{"marked":true}` |
| `POST /name-flags` | `workspaceId`, `adminId`, `personId` | `{"flagged":true}` |
| `POST /asking` | `workspaceId`, `judging` of `{"fits":[concept titles]}` | `{"scripted":true}` |
| `POST /authenticators` | `email`, optional `codes` of `"none"` for no recovery codes | `key`, `recoveryCodes` |
| `GET /codes?email=` | | `code` |
| `GET /links?email=` | | `token` |
| `GET /emails?to=` | | `sent`, the count of emails captured for the address |

`verifications` on a concept is a list of `{by, at}`. `by` is the id of a member of the workspace, and a verification with no `by` is the suite's machine verifier's. `at` is an ISO date and time. The newest one sets the concept's trust and the older ones are its history. Give `verifications` or `trust`, not both, since `trust: "human-reviewed"` writes one verification by the seeding user at the time of the seed.

`collection` on `POST /guides` seeds one bid-library guide over that collection's concepts. It adds no Northgate concepts and no `finance` group, writes no Brief, and refuses a collection with no concept. It takes no `financeUserIds`. A concept joins the guide when its `kind` is exactly a bid-library kind, such as `company fact` or `insurance policy`, and its `tags` hold that fact's tags.

A concept's `frontmatter` takes `generated` as a list, `[{"by":"okf-extract/0.4","at":"2026-02-10"}]`, because frontmatter holds no nested object. `stale_after` in the past reads *Out of date*.

`scripts/seed-knowledge.sh <port>` seeds the Northbridge Safeguarding set through these routes.
