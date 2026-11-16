# Stage 41 continuation — handoff index (2026-11-16, second session)

Read first: Issue #78, `docs/HANDOFF41.md`, `docs/SAVE41.md`. This file lists what the continuation session did and where to find it. Nothing was merged, made Ready, force-pushed or published; **Pages still serves 8b1de5b** (PR #75; the bundle match was not re-verified in this session). PR #73 (rail V2) is NOT included anywhere.

## Branch / PR map (all Draft)
| PR | branch | base | content | detail doc |
|---|---|---|---|---|
| #76 | claude/s41-save-safety | claude/fix-city-tap | save safety (A/B), decision save points | SAVE41.md |
| #77 | claude/s41-ui | claude/s41-save-safety | top policy line, 路線帳/都市, + audit fixes (0号 repair in relocation years only; tap67 retry cap 2%) | HANDOFF41.md "Audit round" |
| #79 | claude/s41-simple | claude/s41-ui | simple intervention mode | SIMPLE41.md |
| #80 | claude/s41-night | claude/s41-ui | night view | NIGHT41.md |
| #81 | claude/s41-special | claude/s41-ui | special routes (core rules) | SPECIAL41.md |
| #82 | claude/s41-tech | claude/s41-ui | 【架空】 tunnel marks, 2026 tunnel limit | TECH-HISTORY41.md |
| #83 | claude/s41-north | claude/s41-ui | northern measurement + findings, no behaviour change | NORTH41.md |
The feature PRs #79–#83 are siblings on #77, not a chain: merging them together needs conflict resolution in `engine.ts` / `types.ts` / `app.ts` / `stage3.ts` (each adds imports/fields) — do it in one integration branch and re-run the full suite.

## Status per Issue #78 item
1. Simple intervention mode — done (#79); coast axis only steers the next era change (documented).
2. Night view — done (#80), unit + Chromium E2E; **look/performance on a real Pixel 7a unverified**.
3. Special routes — core rules done (#81); **UI for extension/loops and SVG glyphs NOT done**.
4. 【架空】/long tunnels — done for tunnels with verified records only (#82); bridges and earlier records NOT done (sources not verified).
5. Northern regions — measured only (#83). **Not improved**; findings and a design are in NORTH41.md.
Audit items: 0号 repair false positives — fixed and tested (#77); decision-save loading — covered by decision41.test.ts, device-unverified; tap67 retry — now fails if >2% of places need a retry and logs `T67 RETRY SUMMARY`; 旧地形保存② — NOT restorable, quarantined originals untouched.
Future ideas in Issue #78 (international transport, standard scenario, 50-prefecture ranking, fictional world history, disaster-free world, warming/typhoon layers, sea-level rise) — **not implemented**, as instructed.

## CI at the time of writing
CI for the new heads had just started (≈1 h per run); results were not available when this was written. Check `get_check_runs` on each PR before relying on any of the above. Earlier heads: #76 219aa0c and #77 f9e13a6 had both runs successful.

## For the next ChatGPT audit
- #81: does a relocation with `sim.special41` build the right symbol; does a saved A号 load with the old build's data? Is the `gen`-based exclusion from `numreg` enough?
- #82: is conservative marking acceptable (tunnels the table cannot judge stay unmarked)? the cap is module-global (`setTunnelCap`).
- #80: night-sheet alpha 0.9 and the light curve are design choices, not history.
- #79: sea/air items `s-sea`/`s-air` are new (no detailed item existed).
- Probe `KFM_NORTH` baseline for any change to potential/population.
