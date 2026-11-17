# Issue #91: cities and roads on a mountain the player made (Fuji moved onto Tokyo) — first fix

## Reproduced (unit test `tests/unit/fuji91.test.ts`, data `docs/data/terrain91.json`)
Fuji moved onto 東京's position, size ×5 with the height link (`auto`): 東京's office cell stands at **11,328 m** (slope 22 %), 横浜 5,013 m, 千葉 3,433 m, さいたま 4,441 m; site quality (buildable share around the city) **0** for all four. (×3: 東京 7,552 m.) Fuji itself is not flattened by anything here.
Before the fix, in an 1800 game (seed 7, capital 東京, sub-capital 大阪) at 1927: 東京 **3.6 million**, 横浜 1.0 M, 千葉/さいたま ~0.5 M; 297 km of open road within 70 km of 東京 and **374 km of open road above 1,500 m**.

## Cause
`siteCapacity` (Stage 12) never went below **0.15**: a city with no buildable land at all still kept 15 % of its size, and the capital's and the seats' growth pushed past the rent limit; nothing else looked at the elevation of an EXISTING city (Stage 39's elevation rules only govern NEW 市/町/村 and the old municipalities).

## Fix (general, no place named)
- `land.ts uninhabitable(w, c)`: the office cell is at or above 1,300 m (the Stage 39 limit for a 市) AND the site quality is under 0.05 (practically nothing buildable within ~20 km). Its capacity floor is 0.01 instead of 0.15.
- `engine.ts capUninhabitable` (yearly): such a city holds at most **5,000** people whatever its role; the excess goes to the habitable cities of its prefecture (else the nation, by size). The timeline says so once per city ("住める土地がなく…", and that the capital/sub-capital designation was NOT changed).
- Nothing is deleted: the city, its prefecture role, the seats, roads and saves stay. A save made before simply sees these cities shrink over the following years (gradual repair).
- On the real (unedited) terrain no city is uninhabitable (asserted), so normal games are unchanged.

## After the fix (same game)
東京/横浜/千葉/さいたま ≤ 6 thousand; 大阪 grows instead (22.0 M vs 13.4 M in the unedited game, as the capital's share has nowhere else to go); road within 70 km of 東京 **172 km** (unedited game: 2,465 km); open road above 1,500 m **177 km**.

## Not done (next)
- Roads: 177 km still run above 1,500 m — mostly the 1800 highways and the player-drawn 国道1号 that start at the capital. The planner's mountain cost does not yet forbid a trunk road across such a massif; candidate rule: no NEW ordinary road section above 2,600 m or with a sustained grade over the road limit outside a tunnel.
- A seat (capital / sub-capital / palace) on uninhabitable ground is kept where the player put it; only the timeline tells. A screen warning and an explicit "move the seat" choice are not built.
- Other regions (e.g. Fuji onto 大阪) not run yet; the rule is the same everywhere.
