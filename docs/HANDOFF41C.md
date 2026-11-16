# Stage 41 — third session handoff (2026-11-17): the integrated build

Read with Issue #78, HANDOFF41.md, HANDOFF41B.md, SAVE41.md. **GitHub facts win over this file.**
Nothing merged to main, nothing made Ready, no force-push, **no Pages update** (the live site is still PR #75's 8b1de5b as far as this session knows; not re-verified). PR #73 (rail V2) is in none of these branches. No other repository was changed.

## Where the work is
- **PR #85 `claude/s41-integration`** (base `claude/s41-ui` = PR #77): #79 + #80 + #81 + #82 + #83 + #84 merged, plus the work below. **This is the candidate for a playtest build.** The sibling PRs stay open as records; do not merge them separately on top of #85 (already inside).
- Conflicts resolved: import lines and `SimState` fields from every branch kept; `App.start` keeps both the night button and the glyph check; both new tests in `tests/e2e/real.spec.ts` kept (the end of the simple-mode test had been swallowed by the union and was restored).
- #83's two CI failures: `tsc` error in `tests/unit/north41.probe.test.ts` (`c.pref` may be null). Fixed on `claude/s41-north` and in #85.

## Added in this session (all on #85)
| topic | state | doc |
|---|---|---|
| Special routes: extension and loop from the relocation wizard; "complete" = built through; Euler ordering | implemented, unit + touch E2E | SPECIAL41.md (second round) |
| 【架空】 for bridges; bridge cap under sea/air priority | implemented, unit | TECH-HISTORY41.md (second round) |
| Northern regions | **no behaviour change**; earlier "capital runaway" finding corrected (it is the same for 東京); cause of Karafuto's stagnation established (one inland city, no towns); gated-place design written | NORTH41.md (second round) |
| Cross-game exchange `kfm.region.v1` (export + reference reader + sample) | implemented as function + test; no UI | SHARED-DATA41.md |
| Integration E2E `tests/e2e/integration41.spec.ts` | passes locally | — |

## Verification done locally (Chromium emulation, software GL — not a Pixel 7a)
- `tsc --noEmit` clean. Full unit run on the integrated branch: 711 passed, 5 failed **only in the four files that were being edited while it ran**; those files plus save41/specialDraw41 re-run: 48/48 passed. A clean full run is left to CI.
- `integration41.spec.ts`: 1800 start; night view at 1800 = 0 warm pixels; first policy window answered with the simple mode (kept); automatic to 1898 (an automatic window adopted `p-road` from the kept answer); relocation 1900 by hand → 国道0号 (463 km); automatic to 1999; night view = 94 warm pixels; relocation 2000 → **A号(エー)**; save, reload: `special41`, the kept answers and A号 are there; a policy window waiting after the reload is answered and time runs.
- Touch E2E (mobile35): at a relocation 国道1号 is extended by a drawn line (90 km), no 国道0号 is made, reload keeps it.
- E2E of the existing flows and the save-compatibility check against the published build: see the PR's comments / CI for the result at the time of reading (they were still running when this file was written).

## Not done / open (honest list)
1. SVG glyphs for rare symbols on map signs (fallback = katakana reading). Glyph detection has never run on a real Pixel 7a.
2. Extension across the sea; extension outside a relocation event.
3. Northern improvement itself (needs the gated place set + world-version test; design in NORTH41.md). Issues #65/#66/#72 untouched.
4. Earlier-year tunnel/bridge records (only "longer than anything up to 2026" is marked).
5. Region export has no button in the game; `bird-flight-simulator` was not read.
6. Real-device check of everything.
7. National population reaches ~560M by 2000 in an 1800 game and the capital holds 19–25% — a balance topic (Issue #78 keeps ranking/balance for later); recorded, not changed.

## Publishing (needs the owner's approval — not done)
- There is **no approved separate playtest path**: `docs/PLAYTEST_PUBLISHING_PROPOSAL.md` is still a proposal (it needs a new repository). The only way to make this build playable by opening a URL is to update the existing Pages site from a frozen branch (`claude/release-pages-<sha>` + `workflow_dispatch` of `pages.yml`; steps in HANDOFF41.md §8).
- What the owner must be told before approving: version = PR #85 head; contains night view, simple intervention, special routes (new symbols, extension, loop), 【架空】 marks and the sea/air limit, top policy line and renamed screens (#77), save fixes and decision save points (#76); existing saves: see the compat result; old saves from before Stage 36 remain refused (kept, not deleted); rollback = `claude/release-pages-8b1de5b`-style branch of the current live version (check that such a branch exists before publishing; create it from 8b1de5b if not).

## Added after the first writing (same session)
- **CI failures of #77/#79/#80 (and the E2E part of the others) explained and fixed.** The audit's "2% retry cap" in `tap67.spec.ts` counted places that have **no marker on the map** (they are tapped, correctly open nothing, and were "retried" 3 times): CI showed "9 of 66 needed a second tap" and failed. It was the test's counting, not the game: reproduced locally (same 9), fixed so that a place without a marker is tapped once and never counted, and a retry of a real marker is excused **only** when the game itself reports the press and release came more than `TAP_MAX_MS` apart (`tapDiag` in `gestures.ts`, read as `app.tapMiss`). After the fix: 0 of 66 retried on both screen sizes, 3/3 tests pass locally. Pushed to `claude/s41-ui` (7f110b2) and `claude/s41-integration`.
- #81's own CI failure (unit: stage22/stage25) is the "previous route must be complete" rule meeting old tests; fixed in #85 (complete = built through; the Stage 25 test models an old save). The sibling branches #79–#82 were **not** individually re-fixed: #85 supersedes them.
- **Existing-flow E2E on the integrated branch (local)**: real / mobile35 / decision41 / app / techui37 = 86 passed, 0 failed (22.8 min); tap67 3 passed; integration41 1 passed.
- **Save compatibility with the published build** (`tools/compat-check.mjs dist-8b1de5b dist-int41`): 11/16. The 5 failures are exactly the Stage 31–35 migration items that HANDOFF41 §8 says always fail against an old build of Stage 38 or later (`:pre-s35` copy, Stage 34 log); the checks that matter passed: the old game comes back by itself with the same month / capital / routes / cities / population, start year and relocation origin unchanged (1800/1900), not quarantined or locked, keeps playing, manual slot still listed, reload works, and the old build opening the newer save neither errors nor overwrites it.
- Not re-run after the last commits: the full unit suite (CI will).
