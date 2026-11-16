# Pages release record — Stage 41 integrated build (2026-11-17 JST)

Approved by the owner in the conversation: "PR #85 の最新コミットに対応するすべての必須CIが成功した場合に限り、既存のGitHub Pagesを統合版に更新する".

## What was published
- Version: **9e0a8c805f29af18e8cf018254832d79573aa5c7** (head of PR #85 `claude/s41-integration`), frozen as branch `claude/release-pages-9e0a8c8`.
- Contents: night view, simple intervention, special routes (new symbols, extension, loop), 【架空】 tunnel/bridge marks and the sea/air tunnel+bridge limit, top policy line / 路線帳・都市 screens, save fixes and decision save points, cross-game export function (no UI). **PR #73 (rail V2) is not included.** Northern development and population balance are NOT implemented (docs/NORTH41.md).
- Workflow: `pages.yml` run 159 (workflow_dispatch from the frozen branch; its build step ran `npm test`), conclusion **success**.

## Gate that was checked before publishing
- PR #85 head 9e0a8c8: both CI runs (pull_request 43951791670 and push 43951782077) **success** (`npm run typecheck`, unit, full E2E). An earlier head (7653aaf) had failed only `tap67`, whose counting bug was fixed (docs/HANDOFF41C.md).
- Save compatibility, published 8b1de5b → this build (`tools/compat-check.mjs`, local, Chromium emulation): the game saved by the old build comes back by itself with identical month / capital / routes / cities / population, same start year and relocation origin, not quarantined or locked, keeps playing, manual slot listed, reload works; the old build opening the newer save does not error nor overwrite it. 5 of 16 items fail by design (Stage 31–35 migration items that cannot apply to a Stage 38+ old build; HANDOFF41.md §8). Existing saves are never deleted or overwritten.
- Known constraint: saves from before Stage 36 (old terrain) are still refused with a stated reason and kept as they are; they cannot be restored (docs/SAVE41.md).

## Verified after publishing (this session)
- https://gusk2020.github.io/kudo-fudo-miseisen/ → HTTP 200.
- `index.html` references `assets/index-DraMCLrf.js`; its SHA-256 (first 16 hex: `20443f99bdd1ac3d`) is **identical** to the local build of 9e0a8c8 with `BASE_PATH=/kudo-fudo-miseisen/` (`/home/user/dist-int41`).
- Headless Chromium (412×915, software GL) opens the live URL: the map loads (101 cities in the world), no page errors.
- **Not verified**: a real Pixel 7a (feel, performance, the glyph fallback, the night view's brightness); a full play-through on the live URL.

## Rollback (if the owner wants the previous version back)
1. Run workflow `Pages` (`pages.yml`) with ref **`claude/release-pages-8b1de5b`** (the version live before this release, run 158). Older ones: `claude/release-pages-4d933e8`, `claude/rollback-pages-*`.
2. Saves are in the phone's browser storage and are untouched by publishing; the old build puts a newer save aside without overwriting it (compat check, last item).
3. Verify as above (HTTP 200, bundle hash vs a local build of that sha).
