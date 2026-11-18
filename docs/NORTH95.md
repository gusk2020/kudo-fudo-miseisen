# Issue #95 — 樺太の港・千島の町 (独立Draft PR / independent Draft PR)

Branch `claude/s42-north95`, based on `claude/s42-trunk-only-review` (the PR #94 line, which is the Stage 42 playtest candidate). **PR #89 / #90 / #93 / #94, main, Pages and the playtest build are not touched.** The Fuji fix (#91) is not in this branch (it stays deferred, as the owner asked).

> Note on history (honest record): before Issue #95 was written, four northern-town commits had already been pushed to `claude/s42-terrain91` (PR #93) by an earlier turn. They are copied here by `git cherry-pick -x` (so each carries a "cherry picked from" line). Nothing was force-pushed or reverted there; PR #93 keeps them and this branch carries the same changes independently. PR #93 was not changed after the Issue arrived.

## What a NEW game gets (existing saves unchanged)
1. **Five 樺太 coast towns** — 大泊, 真岡, 泊居, 恵須取, 敷香 (`src/data/towns-north.json`, `NORTH_TOWNS`). Kept apart from `TOWNS`, so place names and older worlds are untouched. Put on the nearest coast cell within 3 cells (a harbour on a 5 km grid). Only a new game asks for them (`townsForSeats(..., north=true)` from `app.ts`); a game records its town ids (`sim.towns16`) and rebuilds exactly that list, so no old save sees them.
2. **Island-gateway port rule** (`hubs.ts`, flag `sim.north41`, set only for new 1800 games next to `trunk42`): an island that has never had a port gets one at its biggest coastal town once that town reaches 20,000 people (from 1900), whatever the nation-wide `PORT_MAX` (40, already full by 2000) is; and an island's only open port is not closed for lack of cargo. No place is named in the rule. It is the same rule for every island.
3. `north41` is validated on load (`save2.ts`, like `isl36`): anything but `true` is dropped, so an old save never gets it by accident.

## Measured (1800 start, capital 東京, seeds 1–3; `docs/data/north95-base.json` = the PR #94 line, `docs/data/north95-after.json` = this branch)
Population in thousands, r = road km, t = rail km, ports / airports counted open; "med" = median of the prefectures outside the four northern groups (millions); nat = national total (millions). Base = the PR #94 line (no northern towns); after = this branch.
| seed | 2000 | 樺太県 pop | 樺太 road / rail | 樺太 ports / airports | 札幌県 pop | 函館県 pop | 根室県 pop | med | nat |
|---|---|---|---|---|---|---|---|---|---|
| 1 | base | 23 | 225 / 0 | 0 / 0 | 16,165 | 2,423 | 250 | 5.00 | 584 |
| 1 | after | **490** | 555 / 0 | **1** / 1 | 12,092 | 2,916 | 323 | 5.00 | 585 |
| 2 | base | 55 | 249 / 0 | 0 / 0 | 13,041 | 2,417 | 307 | 5.21 | 583 |
| 2 | after | **430** | 440 / 0 | **1** / 1 | 7,928 | 2,660 | 265 | 5.01 | 586 |
| 3 | base | 24 | 209 / 0 | 0 / 0 | 11,728 | 2,820 | 312 | 5.19 | 584 |
| 3 | after | **451** | 493 / 0 | **1** / 1 | 12,221 | 2,603 | 287 | 4.92 | 586 |
**Against the Issue's yardsticks**: 樺太県 at 2000 = 8.6–9.8 % of the median (target ≥ 5 %) — met; ports ≥ 1 — met (3 of 3 seeds; the first port opens by 1950); intercity road — yes (road km roughly doubles; no rail, as before); airport — 1 (was 0). Sea route: a road ferry 根室–大泊 appears by 1900 in the seed measured (no ferry reached 樺太 before). **Other prefectures ±5 % — NOT met and not claimed**: 札幌県 moves −25 %, −39 %, +4 % between the two runs, 函館県 +20 %, +10 %, −8 %, 根室県 +29 %, −14 %, −8 %; the median −0 %…−5 %; the national total +0.2 %. The same kind of swing (both signs, tens of percent) appeared in the earlier no-port comparison (札幌県 −19 % / +30 %), i.e. the simulation is chaotic: any change to the set of places reshuffles the random stream and the prefectures' growth shares. The honest user-facing difference: **樺太 is now a real region (about 0.45 M people, a port, an airport, longer roads) while the national total is unchanged; individual prefectures elsewhere will differ from the same seed on the previous version, in either direction.** A fair ±5 % test needs many seeds and a proper noise floor; not done.
**Regression**: full unit suite 743 passed / 10 skipped (includes #65 population branches, #66 rail audit, #72 islands). Save compatibility, Stage 41 published build → this build (`tools/compat-check.mjs`): 11 / 16, the same five by-design failures as for PR #93 (the Stage 31–35 save migration copies), nothing new; an old game comes back with the same month / capital / routes / cities / population. E2E (Playwright) and CI: run by CI on the Draft PR; not run locally here.

## Kurils (千島) — NOT implemented, with the evidence
Checked on the real terrain grid (`generateTerrain` of the default Japan, islands on) by converting lon/lat with `lonLatToReal` then `realToWorld("hokkaido", …)`:
| place | world km | grid |
|---|---|---|
| 根室 | [773, 700] | land, 根室県 (HK-NEM) — exists |
| 国後島 泊 (44.03N 145.86E) | [798, 777] | **sea** (elev −449 m) |
| 国後島 留夜別 | [776, 785] | **sea** (−286 m) |
| 色丹島 斜古丹 | [885, 760] | outside the grid |
| 択捉島 紗那・留別・蘂取 | [980,910] [959,887] [1074,984] | outside the grid |
**The 国後・択捉・色丹 islands are not on the game's map at all** (no land cells; the world has Nemuro peninsula, Karafuto and the two far islets only). A Kuril town would stand on water. Per the Issue ("海上に役場を置かない … 資料が足りない場合は未実装") they are left out. Making them exist needs the islands added to the terrain (outlines, a terrain-hash change, a new world version) — a separate, larger step that changes the map, which this Issue forbids. Not done, recorded as open.
Also not done: 本斗 (no population source found), 占守・幌筵 (names/positions unverified).

## Sources and what is NOT verified
- Town names and that they were Karafuto towns: Japanese sources found by search (樺太庁 statistics pages, 樺太 town pages); **population figures are from search-result snippets, not from the primary tables**, and are used only as size hints (×0.32, like every town): 大泊 21,799 (time unclear), 真岡 18,151 (time unclear), 泊居 11,777 (Dec 1941), 恵須取 35,115 / 敷香 27,935 (1940 ranking page). Each town carries a `popNote`. **Positions are my linear map calibrated on 豊原 (world [516.94, 1101.28]) and snapped to the coast: an approximation, not surveyed coordinates.**
- The 1800-era sizes in the game are the game's own scaled estimates, not history.
- Wikipedia and the cited data sites are not reachable from this session; nothing was read from them directly.

## Tests
`tests/unit/north42.test.ts` (towns exist, on land and coast, in 樺太県; default selection unchanged), `tests/unit/north95.test.ts` (flag only in new games; 樺太 first port by 1960 and still open in 2000; the same game without the flag gets none), the probe `tests/unit/north41.probe.test.ts` now runs on the towns world a new game gets (`KFM_NORTH_TOWNS=1` adds the 樺太 towns).
