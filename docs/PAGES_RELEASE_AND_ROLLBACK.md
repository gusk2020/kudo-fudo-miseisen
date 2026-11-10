# Publishing Stage 31-35 at the existing Pages URL — state found, rollback, save compatibility

Supersedes the separate-repository idea (docs/PLAYTEST_PUBLISHING_PROPOSAL.md, `VITE_SAVE_NS`): the release keeps the ORIGINAL save names (no `VITE_SAVE_NS`), so existing saves carry on. (`VITE_SAVE_NS` stays in the code, unused by this release.)

## 1. What is published now (read from the GitHub API, not assumed)
| | |
|---|---|
| Pages URL (recorded on the deployment status) | `https://gusk2020.github.io/kudo-fudo-miseisen/` |
| Latest successful Pages deployment | id `7453011582`, **sha `eb02cc7da89189fbc2ed271a7403d89a5929021a`**, ref `claude/stage29`, 2026-10-31 02:27:44 UTC, state `success` |
| That commit | `Merge pull request #52 from gusk2020/claude/stage30a` (Stage 29 + Stage 30A) |
| Workflow | `.github/workflows/pages.yml`: push on a list of branches (ends at `claude/stage30a`) + `workflow_dispatch` from any ref; `npm ci` → `npm test` → `npm run build` with `BASE_PATH=/kudo-fudo-miseisen/` → `deploy-pages` (one site, concurrency group `pages`) |
| Not readable from here | Pages settings and the `github-pages` environment's branch rules (the API path is refused by the session's proxy). Earlier deployments came from `claude/**` branches, so those refs are accepted; if the deploy job is refused for the new ref, that is the one setting the owner would have to change |

## 2. Rollback (prepared BEFORE touching the deployment)
- Branch **`claude/rollback-pages-eb02cc7`** points at exactly `eb02cc7…` (the live commit). It is not in `pages.yml`'s push list, so creating it deployed nothing.
- To go back: GitHub → Actions → "Pages" → Run workflow → branch `claude/rollback-pages-eb02cc7`. That rebuilds the old tree with its own workflow and replaces the site with the old version at the same URL. Nothing is deleted by either direction.
- Checked here: that tree installs, passes its own unit tests and builds (result recorded in the PR), and the cross-version save check below runs the old build.

## 3. What publishing replaces
Running "Pages" from `claude/stage31-35-audit` **replaces** the live Stage 29/30A site with the Stage 31-35 site at the same URL (one Pages site per repository). It does not touch any branch, does not merge, and the old site can be restored with the step above.

## 4. Save compatibility (the same origin, the same names)
Browser storage (IndexedDB `kfm-stage1`, keys `s3:auto`, `s3:slot1..5`, checkpoints, `kfm.*` in localStorage) is unchanged by this release.
- `node tools/compat-check.mjs <old dist> <new dist> --base /kudo-fudo-miseisen/` plays a game on the **old** build (the live commit), saves (autosave + manual slot 2), then opens the SAME browser storage with the **new** build, and finally opens what the new build wrote with the old build again. Result: **16 / 16 checks** — the old game comes back (same month, capital, routes, cities, population, start year, first relocation boundary), it is not quarantined, it keeps playing and saving, slot 2 is still listed, reload works, and the old build can open the newer save (so going back loses nothing).
- An older game stays an older game: it has no Stage 34 reclamation log and gets none (island enlargement / reclamation only apply to games started on the new version). Its relocation schedule is its own start year + 150.
- **`s3:auto:pre-s35`**: the first time the new build is about to overwrite a save written by an older version, the original text is copied to this key. It is never overwritten or deleted by the app (tested: byte-identical to what the old build saved).
- The app already keeps `:prev`, `:backup` and `:broken` copies; nothing here removes them.
