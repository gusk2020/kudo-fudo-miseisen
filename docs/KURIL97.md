# 千島 (国後・色丹・択捉) の町 — 再検証と試作 (Draft PR, branch `claude/s42-kuril97`, based on PR #96's branch `claude/s42-north95`)

PR #89/#90/#93/#94/#96/#97/#98, main, Pages and the playtest build are not touched. This branch only adds to #96's branch (it is a separate PR on top of it). Fuji (#91) stays deferred.

## 1. Re-check of "the islands are not on the map" — that conclusion was WRONG (my measurement error)
PR #96's docs (`NORTH95.md`) said 国後・択捉・色丹 have no land cells and sit outside the grid. Re-measured by building the world the way a new game does (`buildWorld(t, seed, towns, 3)`):
- The **world grid is wider than the terrain's own**: `withIslets` (islands20.ts) adds columns/rows. Raw terrain grid x0 = −885, y0 = −1250, 344 × 546 cells; world grid x0 = **−1280**, y0 = **−1850**, 608 × 677. My earlier probe computed the cell index with the raw terrain's grid but read the world's arrays — the two index spaces differ, so every Kuril sample read the wrong cell (water or "outside"). The earlier probe was wrong; the data was never missing.
- The Kuril islands exist as **real-outline islets** (`src/data/islets.json`, 地球地図日本 outlines) in 根室県 (`HK-NEM`): 択捉島 144 cells (own island id), 国後島 63, 色丹島 10, 水晶 1, 志発 3, 多楽 1, 勇留 1, and the northern chain (得撫 69, 新知 15, 計吐夷 3, 羅処和 2, 松輪 4, 温禰古丹 21, 幌筵 102, 占守 22; these are marked `provisional` there).
- So the four causes the task asked to tell apart: *data missing* — no; *out of range* — no (the world grid reaches them); *coordinate offset* — only in my probe (wrong index space); *display only* — no. The real gap was different: **no town placed on them**, because towns are placed in the terrain step, which runs before the islets exist, so a Kuril town could never have been placed there.
- **Correction to PR #96's record**: its Kuril section should be read as superseded by this file. (#96 was not edited, as asked; a comment on Issue #95 points here.)

## 2. What was added (new games only)
- Three towns on the islets, in `towns-north.json` with `islet: true`: **泊 (国後島)**, **斜古丹 (色丹島)**, **紗那 (択捉島)**. They are placed in `buildWorld` (world.ts) on the **nearest coast land cell of the same islet within 3 cells**; never on water, never moved to another island; 根室県 (`HK-NEM`) comes from the cell's own prefecture. Their ids are added to a new game's town list by `townsForSeats(..., north=true)`; a game made before keeps the ids it recorded, so no old save sees them. The terrain hash is unchanged (checked in `tests/unit/kuril97.test.ts`).
- Where the islets are not on the grid (a world built without islets) they are simply not placed.
- Not added: 留夜別・留別・蘂取 (no position I could confirm), the Habomai and northern Kuril towns (no source for a town there; 占守・幌筵 names stay out), 本斗.

## 3. Sources: fact vs. game value
| | what | source / status |
|---|---|---|
| Existence of the villages 泊村 (国後), 留夜別村 (国後), 留別村・紗那村・蘂取村 (択捉), 色丹村 | fact | 外務省の表 as quoted on spf.org (Sasakawa Peace Foundation) via search |
| 1945-08-15 populations: 泊村 4,864 / 色丹島 1,038 / 紗那村 1,001 | fact (secondary: quoted table) | same; used ONLY as a size hint (×0.32 like every town), not as 1800 history |
| 古釜布 = ユジノクリリスク, 44°02′N 145°51′E | modern coordinate | search results (Wikipedia mirrors); used for 泊 as an **approximation** — not the surveyed position of the old village office |
| 斜古丹 43.87°N 146.83°E, 紗那 45.23°N 147.88°E | **approximate game placements** | from memory of the modern places (Malokurilskoye, Kurilsk); **not confirmed by any reachable source**; flagged in each town's `popNote`; snapped to the coast cell of the islet |
| the islets' shapes | fact | 地球地図日本 outlines already in `islets.json` |
Wikipedia, the cited data sites and ja.wikipedia are not reachable from this session (only search results). Nothing above is stated as surveyed history; each town's `popNote` says so.

## 4. What it does in play (1800 start, capital 東京, seeds 1–3; same code, towns world with islets, with and without the three towns: `docs/data/kuril97-base.json` / `kuril97-after.json`)
- The three towns are about 2 k people each in 1900 (the game's own floor for a place; the ×0.32 of the 1945 figures is below it) and grow by the existing mechanisms to about 7 k (泊), 3 k (斜古丹), 2 k (紗那) by 2000 (seeds 1 and 2 measured; small places, as the sources suggest).
- **Sea links appear by themselves** (existing ferry rules, no forcing): 根室↔泊, 泊↔斜古丹, 斜古丹↔紗那 and 泊↔大泊 (樺太) are open by 1900. Note the 泊↔大泊 link is an existing "島・半島の間を結ぶ航路" rule (INNER_MAX_KM) acting once both ends exist; it is long and early, which is a Stage 40 ferry-timing question, not changed here.
- 根室県 population at 2000: 312→358 k, 310→317 k, 273→304 k (seeds 1–3); road km 178→233, 166→237, 159→264 (roads on the islands). **No port and no airport appears on the Kuril towns**: they stay under the 20,000 of the island-gateway rule (and the airport rule) — "ports follow the existing demand rules", not forced.
- Other prefectures move by tens of percent between any two runs (札幌県 10.4→6.1 M, 5.7→16.1 M, 14.8→14.5 M): chaos of the stochastic game, as in PR #96's record. The ±5 % criterion is not met and not claimed.

## 5. Tests and checks
New: `tests/unit/kuril97.test.ts` (three towns placed, on land, on the coast, 根室県, three different islands, absent without the flag, terrain hash unchanged, not placed where islets are off the grid); `north42.test.ts` adjusted (the Karafuto list no longer includes the islet towns — data grew, the assertions are the same). The north probe has a `KFM_ISLETS=1` switch to run on the world a new game in the app gets.
Full results (unit suite, save compatibility vs. the Stage 41 build, CI incl. E2E) are in the PR description / HANDOFF; not repeated here to avoid stale numbers.

## 6. Open
- Confirm positions of 斜古丹 and 紗那 and the missing villages from a primary gazetteer (国土地理院の旧地名 / 北方領土の資料) when reachable.
- The three towns are small; if the owner wants the islands to matter more, that is a demand-rule question (hubs.ts gateway thresholds), not a data one.
- 泊↔大泊 ferry timing (see above).
