# T-441's closing measure: the app's text, before and after the rewrite

*Measured 27/09/2026 by T-451, on `main` at `ac4f5c8d` with T-451's three string fixes (below). T-425 and T-442 to T-450 had all merged. The "before" figures are the review's, at `7821975a` on 26/09/2026. The spec is `docs/specs/T-441.md`.*

## In short

The new-user path is about a fifth shorter as source text and about half as long on screen.

- An invitee reads 123 words to reach their first screen, down from 244, over four screens instead of five. That first screen is Questions, not Routes.
- A new person with no invitation reads 91 words to reach *No workspace yet*, down from 178.
- No screen on the path leads with a refusal's code word, and none makes "the platform" a character.
- The consequence-line median is still 30 words. All eight consequence lines are on screens the spec put out of scope.

## How it was measured

Measured the way the review measured, with its scripts from T-441's attachment `a2`.

- **Strings.** `extract.cjs` and `measure.py` ran unchanged. Run over `7821975a` again, they reproduce the review's figures exactly: 781 strings, 5,177 words, 8.0 words a sentence on the new-user path.
- **Word files.** The rewrite moved the new-user path's words out of the screens and into word tables: `sign-in-words.ts`, `invitation-words.ts`, `ask-to-join-words.ts`, the auth `refusal-words.ts`, `keystroke-words.ts` and `app/words.ts`. `extract.cjs` maps screens by file and names none of these files, so 80 strings land on screen "?" and drop off the path. A new step, `remap.py`, gives each one the screen that shows it, by the constant that holds it. The figures below use it. Without it, the path reads 57 strings, 352 words and 7.2 words a sentence.
- **The walk.** `a2`'s Playwright walk pinned the old wording and the old landing, so it was moved to the new screens. It reads the words from the SPA's tables, lands each role at its own home, and names the invitee on the invitation screen. The journeys and steps are the review's. Step 22 is gone: the display-name screen no longer comes before an invitation.
- **Words on a screen.** Every visible token that holds a letter counts. The skip link, the rail, the secondary nav and the auth screens' brand line do not count. Recounted this way, the review's own transcript gives its path totals within two words: 242, 177, 304 and 156.

The strings, the walk's 46 screenshots, its transcript and the scripts are in `.scratch/ui-copy-2026-09-27/`, which is not tracked. The scripts, with a README, are also packed as `t441-ui-copy-review-v3.tgz` there.

## The figures

| Figure | Before | After |
| --- | --- | --- |
| New-user path: strings, words | 141, 1,062 | 147, 851 |
| New-user path: words a sentence (strings of 8+ words) | 8.0 (9.7) | 6.4 (8.5) |
| Every screen: strings, words, words a sentence | 781, 5,177, 8.4 | 770, 4,698, 7.8 |
| Consequence line, median words | 30 | 30 |
| Strings holding "the platform" (on the path) | 28 (7) | 12 (0) |
| Strings with "the platform" as subject | not counted apart; the spec reads all 28 so | 4, none on the path |
| Strings leading with `Refused:` | 4 templates, on 5 walked screens | 0 |
| Glossary words on the path: terms, uses | 11, 69 | 10, 65 |

The path has six more strings but 211 fewer words. Its word tables hold states the old screens never had: "Send a new code", the arrival lines and the name field on the invitation. All 12 strings still holding "the platform" are on the console, Sources or a People dialog. In seven of them it is a place ("on the platform") and in one a possessive, not an actor.

### Words read before the first useful screen

| Path | Before | After |
| --- | --- | --- |
| Invited newcomer: sign-in, code, name, invitation, first screen | 242 over 5 screens (review: 244) | 123 over 4 |
| New person, no invitation: to *No workspace yet* | 177 (178) | 91 |
| … then asking to join, to *Request sent* | 304 (305) | 145 |
| Provisioned Admin: sign-in, code, first screen | 156 (156) | 102 |

"Before" is the review's transcript recounted by the same rule as "after", with the review's published figure in brackets. The spec and *In short* quote the published ones.

An Admin's first screen is now People → Members (60 words), and an invitee's is Questions (26). Both used to be System → Routes and spend (113).

### Words on each walked screen

Both columns are counted the same way (*How it was measured*). Step 46, after Cancel on the consent page, is left out as the review left it out: it is claude.ai's page, not the app's.

| Step | Before | After |
| --- | --- | --- |
| 01 Sign in | 18 | 16 |
| 02 Code sent | 25 | 26 |
| 03 Wrong code | 41 | 40 |
| 04 Display name | 38 | 16 |
| 05 Name refused | 51 | 27 |
| 06 No workspace yet | 96 | 33 |
| 06b Keyboard shortcuts list | 128 | 62 |
| 07 Blank reason | 116 | 51 |
| 08 Asked | 127 | 54 |
| 09 Asked too often | 107 | 44 |
| 10 Admin's first screen | 113 (Routes) | 60 (Members) |
| 10b System → Routes, now visited | — | 40 |
| 11 System → Signals | 22 | 24 |
| 12 Sources → Bindings, empty | 48 | 25 |
| 13 Sources → Priced plan | 39 | 23 |
| 14 Suggestions | 24 | 21 |
| 15 Knowledge | 36 | 25 |
| 16 Questions | 29 | 26 |
| 17 People → Members | 63 | 60 |
| 17a Invitations tab, empty | 51 | 33 |
| 17b Requests tab, empty | 59 | 33 |
| 18 Groups, empty | 89 | 52 |
| 19 Audit log | 96 | 93 |
| 20 Invitation link, signed out | 18 | 24 |
| 21 Code sent | 25 | 26 |
| 22 Display name, before the invitation | 38 | gone |
| 23 The invitation | 48 | 47, with the name field |
| 24 Invitee's first screen | 113 (Routes) | 26 (Questions) |
| 25 Top bar's menu | 115 | 28 |
| 26 Signed in at another address | 37 | 28 |
| 27 Link names no invitation | 35 | 23 |
| 30 Person menu | 115 | 62 |
| 31 Just signed out | 18 | 20 |
| 32 Session ended | 18 | 20 |
| 33 Choose a workspace | 24 | 11 |
| 34 Removed from a workspace | 38 | 18 |
| 35 List unread | 11 | 9 |
| 36 Too many codes | 33 | 31 |
| 40 Routes with one route | 113 | 57 |
| 41 Failed screen | 50 | 27 |
| 42 Unknown address | 20 | 8 |
| 43 Session ended on save | 50 | 26 |
| 44 Sign-in, from Claude | 18 | 19 |
| 45 Connect Claude | 75 | 71 |
| 47 Revoked before Connect | 12 | 18 |
| 48 Non-member, from Claude | 96 | 33 |

A few screens grew, and each for a reason the spec asked for. Sign-in now names where it leads ("Sign in to join a workspace") and why the person is there ("You have signed out"). The revoked consent page gained its sign-in link. Step 36 shows "Your session has ended" as well, because the walk clears the session cookie before it floods the code ceiling.

## The *Clarity* rule on the rewritten path

Every string on the path was read against §3's *Clarity* rule, along with the shared refusal and empty-state templates and the walked screens. Three breaches were small enough to fix in T-451:

- **The empty Groups tab put a sentence under its create form:** "A binding's audience can name the group." The spec says this tab adds none, and the sentence explains the system in glossary words. It is gone, with the field's `aria-describedby`.
- **The empty-name refusal said "Type the name you want to be credited by."** "Credited" is the house voice the review flagged. It now reads "Type the name you want others to see."
- **The control-character refusal said "A display name cannot hold a control character, such as a tab."** It now says "a special character", in the reader's words.

The console's own wording of the empty-name refusal said "credited by" too, so it moved with the second fix: "Type the name others are to see them by."

Three more are filed as tickets:

- **T-461: an Editor's or Viewer's first screen is named "Answer audit".** The breadcrumb reads "Questions · Answer audit" and the view's heading "Answer audit": a glossary word a newcomer doesn't have yet, on the first screen they see. The fix is the view's name in the screen list, which the routes and specs read.
- **T-462: the session-ended line repeats its button.** "Your session has ended. Sign in again." is followed by a **Sign in again** button on the auth screens, and by a link of the same name in the console. The template's next step and the control say the same thing.
- **T-463: a non-member who came from Claude never hears of Claude again.** Sign-in says "Sign in to connect Claude". *No workspace yet* then says nothing about the connection, which ends there.

Off the path, which the spec leaves until each screen is next touched, the audit log still opens with a 26-word definition and repeats it in its table caption.
