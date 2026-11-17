# Stage 41 #10: northern regions (北海道3県・樺太・千島) — measurement and findings

Status: **measured and documented; the game's behaviour was NOT changed in this round.** Reason: both problems found below sit in the population/potential system that Issue #65 (discrete population branches) and the rail audit (#66) are about; changing it without a larger regression comparison would risk the very audits the user wants kept separate. The tool and data to do that comparison now exist.

## Tool and data
- `tests/unit/north41.probe.test.ts` — gated (runs only with `KFM_NORTH=<out.json>`; skipped in normal runs). 1800-start games, several seeds × capital placements, state at 1900/1950/2000: population per prefecture (cities + settlements), open road/rail km, ports, airports, and the median population of the other prefectures.
- Result file: `docs/data/north41-baseline.json` (seeds 1–3 × capital at 東京 JP-13 / 札幌県 HK-SAP / 樺太県 KRF; sub-capital 大阪 JP-27, balanced era, techK 2, automatic mode). 331 s on 4 cores. Reproduce: `KFM_NORTH=docs/data/north41-baseline.json npx vitest run tests/unit/north41.probe.test.ts`.

## Result at 2000 (population in thousands; r = road km, t = rail km, p = ports, a = airports; "median" = median of the other prefectures)
| capital | seed | median | 札幌県 | 函館県 | 根室県 | 樺太県 |
|---|---|---|---|---|---|---|
| 東京 | 1 | 5,173 | 12,696 r520 t0 p0 a1 | 2,931 r307 t49 p1 a1 | 284 r180 p0 a1 | **32** r243 t0 p0 a0 |
| 東京 | 2 | 5,842 | 15,594 | 2,909 | 275 | **35** |
| 東京 | 3 | 5,547 | 18,379 | 2,570 | 240 | **23** |
| 札幌県 | 1 | 5,988 | **87,209** r526 t17 | 16,825 | 9,690 p1 | 33 |
| 札幌県 | 2 | 6,179 | **85,227** | 19,072 | 9,326 | 28 |
| 札幌県 | 3 | 5,764 | **97,053** | 15,911 | 8,109 | 40 |
| 樺太県 | 1 | 4,997 | 10,861 | 5,589 | 9,201 | **107,029** r105 a1 |
| 樺太県 | 2 | 5,078 | 15,586 | 5,842 | 9,830 | **89,181** r329 |
| 樺太県 | 3 | 4,710 | 16,642 | 6,088 | 9,719 | **94,460** r242 |

## Findings (measured; the cause is not yet established)
1. **A prefecture that holds the capital runs away**: 札幌県 ≈ 85–97 million and 樺太県 ≈ 89–107 million at 2000, i.e. 14–21× the median prefecture (and 樺太 starts from 3,000 people). Same pattern in all three seeds, so it is systematic, not a discrete branch. This is the "exaggeration" in the wrong place: the population exists but 樺太 gets 105–329 road-km, 0 rail, 0 ports (one airport), so people and transport do not match — exactly the inconsistency the request warned about.
2. **With the capital elsewhere, 樺太県 hardly develops at all** (23–40 thousand at 2000, 0 ports, 0 airports, 0 rail) and the Kurils are inside 根室県 (240–284 thousand, one airport, no port). 札幌県 has **0 rail km** at 2000 in every default-capital run; 函館県 has the same 49 km line in every run (looks fixed by the initial network). Hokkaido rail is thus essentially absent although road km is similar to other regions.
3. The 札幌県 figure with the capital in 東京 is already 2.3–3.3× the median; part of that is the 1800-start population being a game estimate (docs/POPULATION_1800.md).

## What to do next (design, not implemented)
- Find where the capital's weight compounds (`potential17.ts`: rank weight ≈ 2.4× the mean; `POT_GROWTH`, glide) and add a **capacity ceiling** from the existing land capacity (`land.ts` site capacity, Stage 12) so one prefecture cannot exceed a plausible multiple of the national median; then re-run this probe — the goal is the same order of magnitude as other seats with matching ports/rail.
- Give 樺太・千島 a port/airport rule by policy (`hubs.ts`): sea priority → ports first; air priority → airports; road/rail priority → the island-link/long-tunnel candidates (bounded by #7's 57.09 km limit under sea/air priority, which does not apply here).
- Re-run the probe for the other issues' sensitive cases (#65 seeds; #66 rail; #72 islands) before and after.

## Old place names: sources and what is NOT verified (2026-11-16 web search)
Verified (as stated by the cited pages):
- 樺太庁 office moved from 大泊 to 豊原 on 1909-08-10 (JACAR glossary); 豊原 was the central city. 本斗 支庁 created 1909 under 真岡, promoted 1922, merged with 泊居 into 真岡 支庁 in 1942-11. 恵須取 grew from 594 people (1923) to 14,535 (end of 1928) (kushiro.repo.nii.ac.jp paper). Karafuto's total population around 1940 ≈ 400,000, ~95% mainland Japanese.
- Four northern islands on 1945-08-15 (Sasakawa Peace Foundation citing 千島歯舞諸島居住者連盟 / Northern Territories HQ): 色丹島 1,038 (206 households); 国後島 泊村 4,864 and 留夜別村 2,500; 択捉島 留別村 2,258, 紗那村 1,001, 蘂取村 349; total 3,124 households / 17,291 people; 歯舞群島 5,281 (5 islands). 色丹郡・国後郡・紗那郡・蘂取郡・択捉郡 under 根室支庁 (MOFA).
NOT verified (no source found): city-by-city populations and municipal-status years of Karafuto, place names of the northern Kurils (占守 片岡湾 柏原 …). Names used in game data must be taken from gazetteers (樺太庁統計書, 樺太年鑑, NDL) before use; **ja.wikipedia.org is not reachable from this session** (network allowlist), so it could not be used. The names above are history, not a claim about present-day sovereignty; the game's 1800-start world is fictional and the existing 樺太県/根室県 membership (docs, `kuril1800.ts`) is unchanged.

## Second round (2026-11-17): correction and cause — still no behaviour change
**Correction of finding 1.** "The prefecture holding the capital runs away" is NOT a northern problem. The probe now also records the national total and the top five prefectures (seed 1):
| capital | year | national | top prefectures (millions) | median |
|---|---|---|---|---|
| 東京 | 1900 / 1950 / 2000 | 54M / 202M / 562M | 2000: 東京 142, 大阪 62, 愛知 38, 神奈川 36, 兵庫 21 | 5.2M |
| 樺太 | 1900 / 1950 / 2000 | 54M / 201M / 554M | 2000: 樺太 107, 大阪 75, 愛知 39, 神奈川 32, 兵庫 26 | 5.0M |
The capital holds 19–25% of the nation wherever it is (東京 142M is larger than 樺太 107M), and the national total itself reaches ~560M by 2000 in an 1800-start game (about 4.4× real Japan). So the size of a capital prefecture is the game's general concentration/scale, i.e. the "balance" and "50-prefecture ranking" topics Issue #78 keeps for later — not something to patch for the north alone. The earlier wording ("runs away", "14–21× the median") was measured correctly but attributed wrongly.

**Cause of finding 2 (樺太・根室 stagnate when the capital is elsewhere) — established from the data files.** 樺太県 has exactly one settlement the simulation knows as a city: 豊原 (inland, 3,000 people; `src/data/islands-extra.json`), and no provincial towns (`src/data/towns.json` has none for KRF or HK-NEM). 根室県 has only 根室市 (25,000). With one inland city there is no coastal city for a port, no second city for an intercity road/rail demand, and nothing in the Kurils at all. The planner behaves consistently; the data gives it nothing to connect.

**Why it was not fixed tonight.** Adding places changes the world every game is built on. A saved game must meet exactly the world it was made with (`sim.towns16` is compared on load; a changed world is how the "地形ハッシュ不一致" refusal of old saves came about). The addition therefore needs its own flag (like `isl36`), a world-version test against the published build, and a save-compatibility run — a stage of its own, not a late-night patch.

**Design for that stage (not implemented).**
- A gated place set `north41` (new games only): 樺太 — 大泊 (south-coast port; the 樺太庁 seat before 1909), 真岡 (west-coast port), 本斗, 泊居, 恵須取 (594 people in 1923 → 14,535 by 1928), 敷香; 千島 (根室県) — 国後島 泊・留夜別, 択捉島 留別・紗那・蘂取, 色丹島 斜古丹. Existence and the figures quoted are source-verified (list above); **coordinates and 1800-era sizes are not** and must come from a gazetteer before use. 占守・幌筵 names stay out until verified.
- Starting sizes small (they are 1800), growth by the existing mechanisms: a coastal place lets `hubs.ts` open a port; two or more places give the planner intercity demand; sea priority → ports/ferries first, air priority → airports, road/rail priority → the existing strait-link candidates (宗谷海峡 is ~42 km: over every 2026 bridge record, inside the tunnel record).
- Acceptance by the probe: with the capital in 東京, 樺太県 ≥ 5% of the median prefecture at 2000 with ≥1 port and intercity road; other prefectures' figures within ±5% of the baseline; Issue #65/#66/#72 cases re-run.
- The "exaggerated population" the user asked for should then come from this (settlement, ports, migration), not from a multiplier on one city.

## Third session (2026-11-18): feasibility measured — still not implemented, and why
Measured with a scratch test (removed): the 樺太 coast towns of the design, placed by a linear lon/lat→world-km map calibrated on 豊原 (world [516.94, 1101.28] = 142.74°E 46.96°N; ~111.2 km per degree of latitude, ×cos(lat) for longitude; the island's polygon spans y 984–1437, x 433–699 km):
| town | world km | result |
|---|---|---|
| 大泊 | [519, 1065] | **water** (south coast; an approximate map misses by a cell or two) |
| 真岡 | [465, 1111] | land, 樺太県, 271 m |
| 本斗 | [450, 1070] | land, 樺太県, 292 m |
| 泊居 | [467, 1190] | land, 樺太県, 197 m |
| 恵須取 | [467, 1336] | land, 樺太県, 261 m |
| 敷香 | [545, 1353] | land, 樺太県, 196 m |
Reading: five of six land on the island, but the coastal ones sit 200–300 m up (inland of the real harbour), so a port rule needs the town **snapped to the nearest coast cell** (a new, bounded placement rule: nearest land cell within 3 cells that touches water), not the plain "drop it if not land" rule the provincial towns use. The Kurils: this probe could not place them (the world position of Kunashir/Iturup needs the Hokkaido body transform; the quick call returned the input unchanged), so that part is **unmeasured**.
Saves are NOT a blocker: a game records its town ids (`sim.towns16`) and rebuilds exactly that list, so appending towns to `towns.json` cannot change an old save.
**The blockers are elsewhere**: (1) a new game's town list comes from `townsForSeats` (world.ts) which is called by the UI and by many tests; adding the northern towns there changes every new-game world and therefore every pinned figure in the unit tests (Issue #65/#66/#72 audits) — it needs an opt-in option threaded through `app.ts`, `simhelp.ts` and `townsForSeats`; (2) the populations of those places are not sourced (see above) and must not be invented; (3) acceptance needs the probe re-run before/after across seeds (≈6 min per run on 4 cores).
Suggested order when this is taken up: opt-in `north41` world option → coast-snap rule + the six 樺太 towns with sourced figures → probe → Kurils (after the Hokkaido body transform is understood) → ports/airports rules in `hubs.ts`.
