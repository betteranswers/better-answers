# The harness routes the recipes call

`scripts/harness.sh` calls these under `/__harness`.

| Route | Body | Answer |
| --- | --- | --- |
| `POST /workspaces` | optional `name` and `adminEmail` | `workspaceId`, `name`, `shortName`, `admin` with `id`, `email`, `name` |
| `POST /people` | optional `email` and `displayName`; a person in no workspace | `id`, `email`, `name` |
| `POST /members` | `workspaceId`, `userId`, `role` of `Admin`, `Editor` or `Viewer` | `{"added":true}` |
| `POST /invitations` | `workspaceId`, `email`, `inviterId`, `role` | `id` |
| `POST /concepts` | `workspaceId`, `userId`, `concepts` of `title`, `body`, optional `collection`, `kind`, `trust` | `concepts` with `iri`, `title`, `path`, `documents` |
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
